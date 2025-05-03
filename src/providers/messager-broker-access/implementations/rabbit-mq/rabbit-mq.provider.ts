import amqp, { Channel } from "amqplib"; // Adicionado Channel para tipagem
import { v4 as uuidv4 } from 'uuid';
import { IMessagerAccess, IMessagerAccessRequest, IMessagerBrokerAccess, IResponseAccessResponse } from "../imessager-broker-access.interface"; // Ajuste o caminho se necessário

export class RabbitMQ implements IMessagerBrokerAccess {

    // URL fixa, idealmente usar variável de ambiente
    private url: string = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

    /**
     * Connect with message broker (Cria nova conexão/canal a cada chamada)
     */
    async connect(): Promise<Channel> { // Alterado para retornar Channel para consistência
        try {
            console.log(`>>> [RabbitMQ - Simples] Tentando conectar em ${this.url}`);
            const conn = await amqp.connect(this.url);
            const channel = await conn.createChannel();
            console.log(">>> [RabbitMQ - Simples] Conexão/Canal criado com sucesso.");
            // Nota: A conexão 'conn' não é armazenada nem gerenciada para reuso ou fechamento posterior nesta versão.
            return channel;
        } catch (error) {
            console.error(`!!! [RabbitMQ - Simples] Falha ao conectar/criar canal:`, error);
            throw error; // Re-throw para quem chamou saber da falha
        }
    }

    /**
     * Create Queue (ou garante que existe)
     * @param channel O canal obtido via connect()
     * @param queue O nome da fila
     */
    async createQueue(channel: Channel, queue: string): Promise<Channel> { // Retorna o canal para encadeamento
        return new Promise((resolve, reject) => {
            try {
                // console.log(`>>> [RabbitMQ - Simples] Garantindo fila '${queue}'...`); // Log opcional
                channel.assertQueue(queue, { durable: true }); // durable = true sobrevive a reinicio do broker
                // console.log(`>>> [RabbitMQ - Simples] Fila '${queue}' garantida.`); // Log opcional
                resolve(channel);
            } catch (err) {
                console.error(`!!! [RabbitMQ - Simples] Erro ao garantir fila '${queue}':`, err);
                reject(err);
            }
        });
    }

    /**
     * Listen RPC (Ouve uma fila esperando requisição RPC e envia resposta)
     * @param queue
     * @param callback Função que processa a mensagem e RETORNA a resposta RPC
     */
    listenRPC(queue: string, callback: (req: IMessagerAccessRequest) => Promise<IResponseAccessResponse>): void { // Callback deve retornar IResponseAccessResponse
        this.connect() // Cria nova conexão/canal para este listener
            .then(channel => this.createQueue(channel, queue))
            .then(ch => {
                console.log(`>>> [RabbitMQ - Simples] Aguardando mensagens (RPC) na fila '${queue}'`);
                ch.prefetch(1); // Processa uma msg por vez (importante para RPC)
                ch.consume(queue, async (msg: any) => {
                    if (msg !== null) {
                        console.log(`>>> [RabbitMQ - Simples] [RPC Listen] Mensagem recebida (corrId: ${msg.properties.correlationId})`);
                        // Verifica se tem as propriedades RPC necessárias
                        if (!msg.properties.replyTo || !msg.properties.correlationId) {
                            console.warn(`!!! [RabbitMQ - Simples] [RPC Listen] Mensagem sem replyTo ou correlationId na fila ${queue}. Descartando.`);
                            ch.nack(msg, false, false); // Descarta se não for RPC válido
                            return;
                        }

                        const request = this.messageConvertRequest(msg);
                        try {
                            const response = await callback(request); // Chama a lógica que GERA a resposta
                            await this.responseCallRPC({ // Usa o método auxiliar para enviar a resposta
                                queue: queue, // Não usado aqui, mas mantido por compatibilidade da interface
                                replyTo: msg.properties.replyTo,
                                correlationId: msg.properties.correlationId,
                                response: response // A resposta completa { code, response }
                            });
                            console.log(`>>> [RabbitMQ - Simples] [RPC Listen] Resposta enviada para ${msg.properties.replyTo} (corrId: ${msg.properties.correlationId})`);
                            ch.ack(msg); // Confirma mensagem original APÓS enviar resposta
                        } catch (error) {
                            console.error(`!!! [RabbitMQ - Simples] [RPC Listen] Erro ao processar mensagem RPC (corrId: ${msg.properties.correlationId}):`, error);
                            // Tenta enviar uma resposta de erro genérica
                            try {
                                await this.responseCallRPC({
                                    queue: queue,
                                    replyTo: msg.properties.replyTo,
                                    correlationId: msg.properties.correlationId,
                                    response: { code: 500, response: { message: 'Erro interno no servidor ao processar RPC' } }
                                });
                            } catch (responseError) {
                                console.error(`!!! [RabbitMQ - Simples] [RPC Listen] Falha ao enviar resposta de erro para ${msg.properties.replyTo}:`, responseError);
                            }
                            ch.ack(msg); // Confirma mesmo em caso de erro para não reenfileirar infinitamente
                        }
                    }
                });
            })
            .catch(err => console.error(`!!! [RabbitMQ - Simples] Erro ao iniciar listener RPC para ${queue}:`, err));
    }

    // ***** MÉTODO NOVO ADICIONADO *****
    /**
     * Listen Pub/Sub (Ouve uma fila e processa mensagens, sem enviar resposta)
     * @param queue
     * @param callback Função que processa a mensagem e retorna Promise<void>
     */
    listenPubSub(queue: string, callback: (req: IMessagerAccessRequest) => Promise<void>): void { // Callback retorna void
        this.connect() // Cria nova conexão/canal para este listener
            .then(channel => this.createQueue(channel, queue))
            .then(ch => {
                console.log(`>>> [RabbitMQ - Simples] Aguardando mensagens (Pub/Sub) na fila '${queue}'`);
                // ch.prefetch(5); // Opcional: controlar quantas msgs processar por vez
                ch.consume(queue, async (msg: any) => {
                    if (msg !== null) {
                        console.log(`>>> [RabbitMQ - Simples] [PubSub Listen] Mensagem recebida na fila '${queue}'`);
                        const request = this.messageConvertRequest(msg);
                        try {
                            await callback(request); // Chama o controller/application
                            ch.ack(msg); // Confirma o processamento BEM SUCEDIDO
                            console.log(`>>> [RabbitMQ - Simples] [PubSub Listen] Mensagem processada e ACK enviada.`);
                        } catch (error) {
                            console.error(`!!! [RabbitMQ - Simples] [PubSub Listen] Erro ao processar mensagem:`, error);
                            // Descarta a mensagem em caso de erro para evitar loop
                            ch.nack(msg, false, false); // false no 3º arg = não reenfileirar
                            console.warn(`!!! [RabbitMQ - Simples] [PubSub Listen] Mensagem NACK (sem reenfileirar) enviada.`);
                            // Em produção, idealmente enviar para uma Dead Letter Queue (DLQ)
                        }
                    }
                });
            })
            .catch(err => console.error(`!!! [RabbitMQ - Simples] Erro ao iniciar listener Pub/Sub para ${queue}:`, err));
    }
    // ***** FIM DO MÉTODO NOVO *****

    /**
     * Send Pub/Sub (Envia mensagem para uma fila sem esperar resposta)
     * @param message
     */
    async sendPubSub(message: IMessagerAccess): Promise<void> { // Retorna void, pois não há resposta útil
        try {
            const channel = await this.connect(); // Cria nova conexão/canal
            await this.createQueue(channel, message.queue);
            console.log(`>>> [RabbitMQ - Simples] [PubSub Send] Enviando para fila '${message.queue}'`);
            channel.sendToQueue(
                message.queue,
                Buffer.from(JSON.stringify(message.message)),
                { persistent: true } // Mensagem sobrevive a reinício do broker
            );
            // Fechando conexão/canal imediatamente após enviar (ineficiente, mas parte do padrão simples)
            await channel.close();
            // await channel.connection.close(); // Opcional fechar conexão também
        } catch (error) {
            console.error(`!!! [RabbitMQ - Simples] [PubSub Send] Erro ao enviar para fila '${message.queue}':`, error);
            throw error;
        }
    }

    /**
     * Send RPC (Envia mensagem esperando uma resposta)
     * @param message
     */
    async sendRPC(message: IMessagerAccess): Promise<IResponseAccessResponse> {
        const timeout = 10000; // Timeout de 10 segundos
        let conn: amqp.Connection | null = null; // Para poder fechar no finally ou timeout
        let ch: Channel | null = null;
        let replyQueueName: string | null = null;
        let consumerTag: string | null = null;
        let timeoutHandle: NodeJS.Timeout | null = null;

        return new Promise(async (resolve, reject) => {
            try {
                conn = await amqp.connect(this.url); // Cria conexão SÓ para esta chamada RPC
                ch = await conn.createChannel();

                await this.createQueue(ch, message.queue); // Garante fila de destino
                const q = await ch.assertQueue('', { exclusive: true, autoDelete: true }); // Fila de resposta temporária
                replyQueueName = q.queue;
                const corr = uuidv4();

                console.log(`>>> [RabbitMQ - Simples] [RPC Send] Enviando para '${message.queue}' (corrId: ${corr}, replyTo: ${replyQueueName})`);

                // Prepara para receber a resposta ANTES de enviar
                const consumePromise = new Promise<IResponseAccessResponse>((resolveConsume, rejectConsume) => {
                    ch!.consume(replyQueueName!, (msg: any) => { // O '!' assume que ch e replyQueueName não são null aqui
                        if (msg && msg.properties.correlationId === corr) {
                            console.log(`>>> [RabbitMQ - Simples] [RPC Send] Resposta recebida para corrId: ${corr}`);
                            const messageResponse = this.messageConvert(msg);
                            resolveConsume(messageResponse); // Resolve a promessa interna do consumo
                        } else if (msg) {
                            console.warn(`!!! [RabbitMQ - Simples] [RPC Send] Mensagem com corrId ${msg.properties.correlationId} inesperado (esperado ${corr}). Descartando.`);
                            ch!.nack(msg, false, false);
                        }
                    }, { noAck: true }) // noAck OK para fila temporária
                        .then(consumeOk => {
                            consumerTag = consumeOk.consumerTag;
                        })
                        .catch(err => {
                            console.error(`!!! [RabbitMQ - Simples] [RPC Send] Erro ao iniciar consumidor na fila de resposta ${replyQueueName}:`, err);
                            rejectConsume(err); // Rejeita a promessa interna
                        });
                });

                // Envia a mensagem RPC
                ch.sendToQueue(
                    message.queue,
                    Buffer.from(JSON.stringify(message.message)), {
                        correlationId: corr,
                        replyTo: replyQueueName,
                        persistent: true // Opcional: se a requisição RPC deve sobreviver a reinicio
                    });

                // Configura o Timeout GERAL
                timeoutHandle = setTimeout(() => {
                    console.warn(`!!! [RabbitMQ - Simples] [RPC Send] Timeout (${timeout}ms) para corrId: ${corr}`);
                    reject(new Error(`Timeout waiting for RPC response (${timeout}ms)`)); // Rejeita a promessa principal
                }, timeout);

                // Espera pela resposta ou pelo timeout
                const result = await consumePromise;
                resolve(result); // Resolve a promessa principal com a resposta

            } catch (err) {
                console.error(`!!! [RabbitMQ - Simples] [RPC Send] Erro durante envio/setup RPC para ${message.queue}:`, err);
                reject(err); // Rejeita a promessa principal
            } finally {
                // Limpeza INDEPENDENTE de sucesso ou falha
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                try {
                    if (ch) {
                        if (consumerTag) {
                            console.log(`>>> [RabbitMQ - Simples] [RPC Send] Cancelando consumidor ${consumerTag}`);
                            await ch.cancel(consumerTag).catch(cancelErr => console.error("!!! Erro ao cancelar consumidor RPC:", cancelErr));
                        }
                        // A fila de resposta (replyQueueName) é autoDelete, não precisa deletar manualmente
                        console.log(`>>> [RabbitMQ - Simples] [RPC Send] Fechando canal RPC.`);
                        await ch.close().catch(chCloseErr => console.error("!!! Erro ao fechar canal RPC:", chCloseErr));
                    }
                    if (conn) {
                        console.log(`>>> [RabbitMQ - Simples] [RPC Send] Fechando conexão RPC.`);
                        await conn.close().catch(connCloseErr => console.error("!!! Erro ao fechar conexão RPC:", connCloseErr));
                    }
                } catch (cleanupError) {
                    console.error("!!! [RabbitMQ - Simples] [RPC Send] Erro durante limpeza de recursos RPC:", cleanupError);
                }
            }
        });
    }

    /**
     * Response RPC (Método auxiliar para enviar a resposta de um listener RPC)
     * @param objResponse
     */
    async responseCallRPC(objResponse: {
        queue: string; // Fila original (não usada para enviar, mas parte da interface)
        replyTo: string; // Fila para onde responder
        correlationId: string;
        response: IResponseAccessResponse; // O payload da resposta { code, response }
    }): Promise<void> {
        let channel: Channel | null = null;
        try {
            // Cria um canal SÓ para enviar esta resposta (ineficiente)
            channel = await this.connect();
            // NÃO cria a fila replyTo aqui, ela já deve existir (é a temporária do sender)
            // console.log(`>>> [RabbitMQ - Simples] [RPC Response] Enviando resposta para ${objResponse.replyTo} (corrId: ${objResponse.correlationId})`);
            channel.sendToQueue(
                objResponse.replyTo,
                Buffer.from(JSON.stringify(objResponse.response)), // Envia o objeto { code, response } diretamente
                { correlationId: objResponse.correlationId }
            );
            // console.log(`>>> [RabbitMQ - Simples] [RPC Response] Resposta enviada.`);
        } catch (err) {
            console.error(`!!! [RabbitMQ - Simples] [RPC Response] Erro ao enviar resposta para ${objResponse.replyTo}:`, err);
            throw err; // Re-throw para o listener RPC saber que falhou
        } finally {
            if (channel) {
                // console.log(`>>> [RabbitMQ - Simples] [RPC Response] Fechando canal de resposta.`);
                await channel.close().catch(err => console.error("!!! Erro ao fechar canal de resposta RPC:", err));
                // await channel.connection.close(); // Fecha a conexão também? Decide o padrão.
            }
        }
    }

    /**
     * Convert Message (RPC Response Payload)
     * @param message
     * @returns
     */
    messageConvert(message: amqp.ConsumeMessage): IResponseAccessResponse { // Tipagem melhorada
        const defaultResponse: IResponseAccessResponse = { code: 500, response: { message: 'Formato de resposta inválido' } };
        try {
            const result = JSON.parse(message.content.toString());
            // Verifica minimamente a estrutura esperada
            if (typeof result === 'object' && result !== null && typeof result.code === 'number' && result.response !== undefined) {
                return result as IResponseAccessResponse;
            } else {
                console.warn("!!! [RabbitMQ - Simples] Resposta RPC não tem a estrutura esperada:", result);
                return { code: 200, response: result }; // Encapsula o que veio
            }
        } catch (e) {
            console.error("!!! [RabbitMQ - Simples] Erro ao parsear JSON da resposta:", e);
            defaultResponse.response = { message: 'Erro ao parsear resposta', raw: message.content.toString() };
            return defaultResponse;
        }
    }

    /**
     * Message Convert Request (Incoming Message Payload)
     * @param message
     * @returns
     */
    messageConvertRequest(message: amqp.ConsumeMessage): IMessagerAccessRequest { // Tipagem melhorada
        const messageRequest: IMessagerAccessRequest = { body: null, message: '' };
        try {
            messageRequest.body = JSON.parse(message.content.toString());
        } catch (e) {
            console.warn("!!! [RabbitMQ - Simples] Conteúdo da mensagem recebida não é JSON válido:", message.content.toString());
            messageRequest.message = message.content.toString(); // Guarda a string original
            messageRequest.body = { rawMessage: messageRequest.message }; // Coloca no body por consistência
        }
        return messageRequest;
    }

    // --- Outras funções da interface (se houver) ---
    // A interface IMessagerBrokerAccess define os métodos públicos.
    // Esta implementação simples satisfaz a interface, mas com a ressalva da ineficiência de conexão.
}