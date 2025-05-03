import { IMailAccess, IMessageMail } from "../imail-access.interface";
import nodemailer from 'nodemailer';
import Mail from "nodemailer/lib/mailer";

require('dotenv').config();

export class MailTrap implements IMailAccess {
    private transporter: Mail;

    constructor() {
        const mailUser = process.env.MAILTRAP_USER;
        const mailPass = process.env.MAILTRAP_PASS;
        const mailHost = process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io";
        const mailPort = parseInt(process.env.MAILTRAP_PORT || '2525', 10);

        console.log(`>>> [MailTrap Provider] Configurando: host=${mailHost}, port=${mailPort}, user=${mailUser ? '***' : 'N/A'}`);

        if (!mailUser || !mailPass) {
            console.error("!!! [MailTrap Provider] Erro: Variáveis MAILTRAP_USER ou MAILTRAP_PASS não definidas no .env!");
        }

        this.transporter = nodemailer.createTransport({
            host: mailHost,
            port: mailPort,
            auth: {
                user: mailUser,
                pass: mailPass
            },
        });
    }

    async send(mail: IMessageMail): Promise<void> {
        console.log(`>>> [MailTrap Provider] Tentando enviar email para: ${mail.to.email} (Assunto: ${mail.subject})`);
        try {
            const info = await this.transporter.sendMail({
                to: {
                    name: mail.to.name,
                    address: mail.to.email,
                },
                from: {
                    name: mail.from.name,
                    address: mail.from.email,
                },
                subject: mail.subject,
                html: mail.body,
            });
            console.log(`>>> [MailTrap Provider] Email enviado com sucesso para Mailtrap! Message ID: ${info.messageId}, Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
        } catch (error) {
            console.error(`!!! [MailTrap Provider] Falha ao enviar email para ${mail.to.email}:`, error);
            throw error;
        }
    }
}