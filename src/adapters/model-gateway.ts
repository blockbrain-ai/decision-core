/**
 * Model Gateway Adapter Interface
 *
 * Host agent wraps its LLM here. Decision Core calls
 * evaluate() when it needs model-assisted decisions.
 */

export interface ModelGatewayOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  context?: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  model: string;
  confidence: number;
  latency: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

export interface ModelGatewayAdapter {
  evaluate(prompt: string, options?: ModelGatewayOptions): Promise<ModelResponse>;
}
