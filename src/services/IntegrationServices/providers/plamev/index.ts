import { IntegrationProvider } from "../types";
import { plamevGet } from "./client";

export const plamevApiUrl = (): string => (process.env.PLAMEV_API_URL || "").trim();
const apiUrl = plamevApiUrl;

const plamev: IntegrationProvider = {
  key: "plamev",
  name: "Plamev",
  description: "Plano de saúde pet: consulte a rede credenciada e os planos e simule cotações durante o atendimento.",
  tools: [
    { key: "rede", label: "Rede credenciada" },
    { key: "planos", label: "Planos" },
    { key: "cotacao", label: "Simular cotação" }
  ],
  isAvailable: () => apiUrl() !== "",
  testConnection: async (token: string) => {
    // Light authenticated read; 401/403 means the token was refused.
    await plamevGet({ apiUrl: apiUrl(), token }, "Estados/consultar");
  }
};

export default plamev;
