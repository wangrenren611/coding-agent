import {  LLMRequest, LLMRequestMessage, LLMResponse } from "./typing";

export interface BaseProviderConfig {
  /** API key or credentials */
  apiKey: string;
  /** Base URL for API */
  baseURL: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum number of retries */
  maxRetries?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** 温度 */
  temperature: number;
  /** 模型 */
  model: string;
  /** 最大 token 数 */
  max_tokens: number;
  LLMMAX_TOKENS: number;
  /** Additional options */
  [key: string]: unknown;
}

export abstract class LLMProvider{
   config: BaseProviderConfig;
   protected constructor(
   config: BaseProviderConfig
   ) { 
    this.config = config;
 }


   /**
    * 从提供商生成响应
    * @param messages The messages for the model
    * @param options Optional parameters including stream callback
    * @returns A promise that resolves to the model's response
    */
   abstract generate(messages: LLMRequestMessage[], options?: LLMRequest): Promise<LLMResponse|null>
}