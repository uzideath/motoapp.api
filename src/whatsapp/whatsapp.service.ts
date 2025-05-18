import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js"
import * as fs from "fs"
import * as path from "path"
import * as qrcode from "qrcode-terminal"
import { exec } from "child_process"
import { promisify } from "util"
import { SendMessageDto } from "./dto"
import { WhatsappGateway } from "./whatsapp.gateway"
import { Cron, CronExpression } from "@nestjs/schedule"

const execAsync = promisify(exec)

@Injectable()
export class WhatsappService implements OnModuleInit {
    private client: Client | null = null
    private isReady = false
    private readonly logger = new Logger(WhatsappService.name)
    private initializationAttempts = 0
    private readonly maxInitializationAttempts = 5
    private lastQrCode: string | null = null
    // Cambiado de readonly a private para permitir reasignación
    private sessionId = `nest-whatsapp-service-${Date.now()}` // ID único para cada instancia

    constructor(private readonly gateway: WhatsappGateway) {
        this.setupClient()
    }

    getLastQrCode(): string | null {
        return this.lastQrCode
    }

    private setupClient() {
        // Configuración mejorada para entornos containerizados
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.sessionId,
                dataPath: "/app/.wwebjs_auth",
            }),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--single-process",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--disable-software-rasterizer",
                    "--disable-features=site-per-process",
                    "--user-data-dir=/app/.wwebjs_auth/session-" + this.sessionId,
                ],
            },
        })

        this.setupEventListeners()
    }

    async onModuleInit() {
        await this.cleanupLockFiles()
        await this.initializeClient()
    }

    private async cleanupLockFiles() {
        try {
            this.logger.log("Limpiando archivos de bloqueo...")

            // Limpiar archivos de bloqueo específicos
            const sessionDir = `/app/.wwebjs_auth/session-${this.sessionId}`

            // Crear directorio si no existe
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true })
            }

            // Verificar y eliminar archivos de bloqueo
            const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"]
            for (const file of lockFiles) {
                const lockFilePath = path.join(sessionDir, file)
                if (fs.existsSync(lockFilePath)) {
                    fs.unlinkSync(lockFilePath)
                    this.logger.log(`Archivo de bloqueo eliminado: ${lockFilePath}`)
                }
            }

            // Establecer permisos
            await execAsync(`chmod -R 777 ${sessionDir}`)

            this.logger.log("Limpieza de archivos de bloqueo completada")
        } catch (error) {
            this.logger.error(`Error al limpiar archivos de bloqueo: ${error.message}`)
        }
    }

    getStatusSync(): { isReady: boolean; info: any | null } {
        return {
            isReady: this.isReady,
            info: this.isReady && this.client
                ? {
                    wid: this.client.info?.wid ?? null,
                    platform: this.client.info?.platform ?? null,
                }
                : null,
        }
    }


    private setupEventListeners() {
        if (!this.client) return

        this.client.on("qr", (qr) => {
            this.handleQrCodeSafely(qr)
        })

        this.client.on("authenticated", () => {
            this.logger.log("WhatsApp client authenticated")

            // Limpiar QR antiguo después de autenticación
            this.lastQrCode = null
        })

        this.client.on("ready", () => {
            this.isReady = true
            this.initializationAttempts = 0
            this.lastQrCode = null

            this.logger.log("WhatsApp client is ready!")

            // Enviar estado a clientes
            this.gateway.sendWhatsAppStatus({
                isReady: true,
                info: {
                    wid: this.client?.info.wid,
                    platform: this.client?.info.platform || null,
                },
            })
        })

        this.client.on("auth_failure", (msg) => {
            this.logger.error(`WhatsApp authentication failed: ${msg}`)
            this.gateway.sendWhatsAppStatus({
                isReady: false,
                info: null,
            })
        })

        this.client.on("disconnected", async (reason) => {
            this.isReady = false
            this.logger.warn(`WhatsApp client disconnected: ${reason}`)
            this.gateway.sendWhatsAppStatus({
                isReady: false,
                info: null,
            })

            // Limpieza y reinicio
            this.client = null
            await this.cleanupLockFiles()
            this.setupClient()

            setTimeout(() => {
                this.initializeClient()
            }, 5000)
        })
    }


    private async initializeClient() {
        if (!this.client) {
            this.logger.warn("⚠️ No hay cliente. Ejecutando setupClient.")
            this.setupClient()
        }

        try {
            this.initializationAttempts++
            this.logger.log(`🚀 Inicializando WhatsApp client (intento ${this.initializationAttempts})`)

            await this.cleanupLockFiles()

            this.logger.log("🕐 Ejecutando client.initialize()...")
            await this.client?.initialize()
            this.logger.log("✅ client.initialize() completado")
        } catch (error) {
            this.logger.error(`❌ Error al inicializar cliente: ${error.message}`)

            this.gateway.sendWhatsAppStatus({
                isReady: false,
                info: null,
            })

            if (error.message.includes("SingletonLock")) {
                this.logger.log("🔁 Error SingletonLock detectado. Reintentando con nuevo cliente.")
                try {
                    await this.client?.destroy()
                } catch (e) {
                    this.logger.error(`Error al destruir cliente: ${e.message}`)
                }
                this.client = null
                await this.cleanupLockFiles()
                this.setupClient()
            }

            if (this.initializationAttempts < this.maxInitializationAttempts) {
                const delay = Math.min(1000 * Math.pow(2, this.initializationAttempts), 30000)
                this.logger.log(`🕒 Reintentando en ${delay / 1000}s...`)
                setTimeout(() => this.initializeClient(), delay)
            } else {
                this.logger.error("❌ Máximo de intentos alcanzado. Abortando.")
            }
        }
    }


    private handleQrCodeSafely(qr: string): void {
        if (this.isReady) {
            this.logger.warn("📛 QR recibido después de estar listo. No se emitirá.")
            return
        }

        this.logger.log("QR Code recibido y será emitido a los clientes")
        this.lastQrCode = qr
        this.gateway.sendQrCode(qr)
    }

    async getStatus() {
        return {
            isReady: this.isReady,
            info:
                this.isReady && this.client
                    ? {
                        wid: this.client.info ? this.client.info.wid : null,
                        // Corregido: Convertir undefined a null explícitamente
                        platform: this.client.info ? this.client.info.platform || null : null,
                    }
                    : null,
        }
    }

    async sendMessage(dto: SendMessageDto): Promise<{ success: boolean; messageId?: string; error?: string }> {
        try {
            if (!this.isReady || !this.client) {
                throw new Error("WhatsApp client is not ready")
            }

            // Format the phone number
            const chatId = this.formatPhoneNumber(dto.phoneNumber)

            // Check if the number exists on WhatsApp
            const isRegistered = await this.client.isRegisteredUser(chatId)
            if (!isRegistered) {
                throw new Error(`Phone number ${dto.phoneNumber} is not registered on WhatsApp`)
            }

            // Send the message
            const message = await this.client.sendMessage(chatId, dto.message)

            return {
                success: true,
                messageId: message.id._serialized,
            }
        } catch (error) {
            this.logger.error(`Failed to send message: ${error.message}`)
            return {
                success: false,
                error: error.message,
            }
        }
    }

    async sendAttachment(
        phoneNumber: string,
        filePath: string,
        caption?: string,
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        try {
            if (!this.isReady || !this.client) {
                throw new Error("WhatsApp client is not ready")
            }

            // Format the phone number
            const chatId = this.formatPhoneNumber(phoneNumber)

            // Check if the number exists on WhatsApp
            const isRegistered = await this.client.isRegisteredUser(chatId)
            if (!isRegistered) {
                throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`)
            }

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`)
            }

            // Create media from file
            const media = MessageMedia.fromFilePath(filePath)

            // Send the attachment
            const message = await this.client.sendMessage(chatId, media, { caption })

            return {
                success: true,
                messageId: message.id._serialized,
            }
        } catch (error) {
            this.logger.error(`Failed to send attachment: ${error.message}`)
            return {
                success: false,
                error: error.message,
            }
        }
    }

    async sendRemoteAttachment(
        phoneNumber: string,
        url: string,
        filename: string,
        mimeType: string,
        caption?: string,
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        try {
            if (!this.isReady || !this.client) {
                throw new Error("WhatsApp client is not ready")
            }

            // Format the phone number
            const chatId = this.formatPhoneNumber(phoneNumber)

            // Check if the number exists on WhatsApp
            const isRegistered = await this.client.isRegisteredUser(chatId)
            if (!isRegistered) {
                throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`)
            }

            // Create media from URL
            const media = await MessageMedia.fromUrl(url, {
                filename,
                unsafeMime: true,
            })

            // Manually set the mimetype after creation
            media.mimetype = mimeType

            // Send the attachment
            const message = await this.client.sendMessage(chatId, media, { caption })

            return {
                success: true,
                messageId: message.id._serialized,
            }
        } catch (error) {
            this.logger.error(`Failed to send remote attachment: ${error.message}`)
            return {
                success: false,
                error: error.message,
            }
        }
    }

    private formatPhoneNumber(phoneNumber: string): string {
        // Remove any non-numeric characters
        const cleaned = phoneNumber.replace(/\D/g, "")

        // Ensure the number has the correct format for WhatsApp API (country code + number)
        // If it doesn't have a country code, we assume it's missing
        if (!cleaned.startsWith("1") && !cleaned.startsWith("91") && !cleaned.startsWith("44")) {
            // This is a simplified example - in a real app, you'd want to handle country codes properly
            this.logger.warn("Phone number may be missing country code, assuming default")
        }

        // WhatsApp expects the format: countrycode+number@c.us
        return `${cleaned}@c.us`
    }

    async logout() {
        if (this.isReady && this.client) {
            await this.client.logout()
            this.isReady = false
            this.logger.log("WhatsApp client logged out")
        }
    }

    async reconnect() {
        this.logger.log("Iniciando reconexión manual de WhatsApp...")

        // Destruir cliente actual si existe
        if (this.client) {
            try {
                await this.client.destroy()
            } catch (e) {
                this.logger.error(`Error al destruir cliente: ${e.message}`)
            }
        }

        this.client = null
        this.isReady = false

        // Limpiar archivos de bloqueo
        await this.cleanupLockFiles()

        // Crear nuevo cliente con ID de sesión único
        // Corregido: Asignar nuevo valor al sessionId
        this.sessionId = `nest-whatsapp-service-${Date.now()}`
        this.setupClient()

        // Resetear contador de intentos
        this.initializationAttempts = 0

        // Inicializar nuevo cliente
        return this.initializeClient()
    }

    async requestQrCode(): Promise<{ success: boolean; message: string } | { success: false; error: string }> {
        this.logger.log("📨 Solicitud explícita de código QR recibida")

        try {
            // Destruir cliente actual si existe
            if (this.client) {
                this.logger.log("🔄 Destruyendo cliente anterior")
                try {
                    await this.client.destroy()
                } catch (e) {
                    this.logger.warn(`Error al destruir cliente: ${e.message}`)
                }
            }

            // Reiniciar estado
            this.client = null
            this.isReady = false

            // ⚠️ Generar nuevo ID de sesión
            this.sessionId = `nest-whatsapp-service-${Date.now()}`
            this.logger.log(`🆕 Nuevo sessionId generado: ${this.sessionId}`)

            // Limpiar archivos
            await this.cleanupLockFiles()

            // Crear cliente y registrar listeners
            this.setupClient()
            this.initializationAttempts = 0

            // Inicializar (esto emitirá el QR si funciona)
            await this.initializeClient()

            return {
                success: true,
                message: "Solicitud de QR iniciada correctamente",
            }
        } catch (error) {
            this.logger.error(`❌ Error al reiniciar cliente para QR: ${error.message}`)
            return {
                success: false,
                error: error.message,
            }
        }
    }
    @Cron(CronExpression.EVERY_MINUTE)
    handleKeepAliveCron() {
        if (this.client && this.isReady) {
            this.client.getState()
                .then(() => this.logger.verbose('🕒 Cron KeepAlive: cliente activo'))
                .catch((err) => this.logger.warn(`⚠️ Cron KeepAlive falló: ${err.message}`))
        } else {
            this.logger.verbose('🕒 Cron KeepAlive: cliente no listo')
        }
    }
}