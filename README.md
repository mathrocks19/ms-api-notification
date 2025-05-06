# Microsserviço: API Gateway

Recebe requisições HTTP (ex: POST /user) e as envia via RPC/RabbitMQ.

## Requisitos

*   Docker & Docker Compose
*   Node.js/npm (usado pelo build do Docker e para rodar outros MS)

## Para Rodar Tudo

1.  **Iniciar Docker (Gateway + MySQL + RabbitMQ):**
    *   Na pasta `ms-api-gateway`:
        ```bash
        docker-compose up -d --build
        ```
2.  **Iniciar `ms-api-user`:**
    *   Configure o arquivo `.env` na raiz do `ms-api-user` (DB MySQL, Rabbit URL=`localhost`).
    *   Abra um terminal na pasta `ms-api-user`.
    *   Instale dependências (se necessário): `npm install`
    *   Execute: `npm run start:dev`
3.  **Iniciar `ms-notification`:**
    *   Configure o arquivo `.env` na raiz do `ms-notification` (com credenciais **Mailtrap**).
    *   Abra outro terminal na pasta `ms-notification`.
    *   Instale dependências (se necessário): `npm install`
    *   Execute: `npm run start:dev`

## Para Parar Tudo

1.  **Parar Docker:**
    *   Na pasta `ms-api-gateway`:
        ```bash
        docker-compose down
        ```
        *(Use `-v` para apagar dados).*
2.  **Parar Serviços Node:** Use `Ctrl+C` nos terminais onde `ms-api-user` e `ms-notification` estão rodando.

## Teste (Após tudo rodar)

*   Envie `POST http://localhost:3000/user` (com JSON no body) via Postman.
*   Verifique a resposta (`201 Created`), o banco MySQL (porta 3307) e o Mailtrap.


  Teste body(Post) Postman 

*   {
  * "name": "Airton Soares",
  * "email": "emailteste",
  * "password": "teste123",
  * "cellPhone": "21911112227"
  * }
