import { sendMailNewUserController } from "../../../../app/send-mail-new-user"; // Ajuste o caminho se necessário
import { IMessagerAccessRequest, IMessagerBrokerAccess, IRouterMessageBroker } from "../imessager-broker-access.interface"; // Ajuste o caminho

export class SendMailNewUserQueue implements IRouterMessageBroker {
    /**
     * Configura o listener Pub/Sub para a fila de envio de email.
     * @param messagerBroker A instância (já conectada) do provider RabbitMQ.
     */
    handle(messagerBroker: IMessagerBrokerAccess): void {
        const queueName = 'send-email-new-user';
        console.log(`>>> [Router] Configurando listener Pub/Sub para fila '${queueName}'`);

        messagerBroker.listenPubSub(
            queueName,
            // Callback para processar cada mensagem recebida via Pub/Sub.
            async (data: IMessagerAccessRequest) => {
                console.log(`>>> [Router] Chamando handle do SendMailNewUserController para fila '${queueName}'`);
                try {
                    // Delega o processamento para o controller/application.
                    await sendMailNewUserController.handle(data);
                    // Sucesso: O 'ack' da mensagem é tratado dentro do listenPubSub.
                } catch(error) {
                    // Erro no processamento: Loga o erro e o re-lança.
                    console.error(`!!! [Router] Erro vindo do sendMailNewUserController.handle:`, error);
                    // Re-lançar o erro permite que listenPubSub dê NACK na mensagem, evitando reprocessamento infinito.
                    throw error;
                }
            }
            // O tratamento de erro na *inicialização* do listener é feito dentro do próprio listenPubSub.
        );
    }
}