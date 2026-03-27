import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

let client: DocumentProcessorServiceClient | null = null;

/** Shared Document AI client using ADC (Cloud Run SA). */
export function getDocumentAIClient(): DocumentProcessorServiceClient {
  if (!client) {
    client = new DocumentProcessorServiceClient();
  }
  return client;
}

/** Processor resource names from env vars. */
export const PROCESSORS = {
  ocr: process.env.OCR_PROCESSOR ?? "",
  formParser: process.env.FORM_PARSER_PROCESSOR ?? "",
  layoutParser: process.env.LAYOUT_PARSER_PROCESSOR ?? "",
} as const;

export type ProcessorKey = keyof typeof PROCESSORS;
