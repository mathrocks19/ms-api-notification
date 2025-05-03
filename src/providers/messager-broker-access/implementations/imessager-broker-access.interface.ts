// Idealmente, importe tipos específicos se for usar tipagem mais forte no futuro
// import * as amqp from 'amqplib';

export interface IMessagerAccess {
    queue: string;
    message: any;
}

export interface IResponseAccessResponse {
    code: number;
    response: any; // O payload da resposta RPC.
}

export interface IMessagerAccessRequest {
    body: any; // O payload recebido (geralmente JSON parseado).
    message: string; // O payload como string (fallback se não for JSON).
    // Poderia adicionar 'properties' do amqp.ConsumeMessage aqui no futuro.
    // properties?: amqp.MessageProperties;
}

export interface IRouterMessageBroker {
    /** Define como um router de fila configura seu listener usando o broker. */
    handle(messagerBroker: IMessagerBrokerAccess): void;
}

/**
 * Contrato para interação com o Message Broker (RabbitMQ).
 */
export interface IMessagerBrokerAccess {
    /** Estabelece conexão com o broker. */
    connect(): Promise<any>;

    /** Garante que uma fila exista no broker. */
    createQueue(channel: any, queue: string): Promise<any>;

    /** Ouve uma fila esperando mensagens no padrão RPC (Request/Reply). */
    listenRPC(queue: string, callback: (req: IMessagerAccessRequest) => Promise<IResponseAccessResponse>): void;

    /** Ouve uma fila esperando mensagens no padrão Pub/Sub (Publish/Subscribe). */
    listenPubSub(queue: string, callback: (req: IMessagerAccessRequest) => Promise<void>): void;

    /** Envia uma mensagem para uma fila no padrão Pub/Sub. */
    sendPubSub(message: IMessagerAccess): Promise<any>;

    /** Envia uma mensagem para uma fila no padrão RPC e aguarda a resposta. */
    sendRPC(message: IMessagerAccess): Promise<IResponseAccessResponse>;

    /** (Método auxiliar para listenRPC) Envia a resposta de volta para o solicitante. */
    responseCallRPC(objResponse: { queue: string; replyTo: string, correlationId: string, response: IResponseAccessResponse }): Promise<void>;

    /** Converte o conteúdo de uma mensagem de resposta RPC recebida. */
    messageConvert(message: any): IResponseAccessResponse; // Idealmente message: amqp.ConsumeMessage

    /** Converte o conteúdo de uma mensagem de requisição/PubSub recebida. */
    messageConvertRequest(message: any): IMessagerAccessRequest; // Idealmente message: amqp.ConsumeMessage
}

// Exportar as interfaces individualmente geralmente é suficiente.
// Manter o bloco abaixo comentado caso precise de um export único no futuro.
/*
export {
   IMessagerAccess,
   IResponseAccessResponse,
   IMessagerAccessRequest,
   IRouterMessageBroker,
   IMessagerBrokerAccess
};
*/