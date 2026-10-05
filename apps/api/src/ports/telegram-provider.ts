export interface TelegramSendResult {
  providerMessageId?: string;
}

export interface TelegramProvider {
  verify(): Promise<void>;
  send(message: string, chatId: string): Promise<TelegramSendResult>;
}
