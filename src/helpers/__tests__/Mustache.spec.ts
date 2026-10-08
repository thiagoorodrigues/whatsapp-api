import formatBody, { formatForCampaign, formatForTicket, matchesTemplate } from "../Mustache";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import Company from "../../models/Company";
import Message from "../../models/Message";

const contact = { name: "Ana D'Ávila & Cia" } as Contact;

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("formatBody", () => {
  it("fills the contact tags", () => {
    expect(formatBody("Oi {{firstName}}! ({{name}})", contact)).toBe(
      "Oi Ana! (Ana D'Ávila & Cia)"
    );
  });

  it("leaves text without tags alone", () => {
    expect(formatBody("Olá, tudo bem?", contact)).toBe("Olá, tudo bem?");
  });

  it("accepts spaces and triple braces around a variable", () => {
    expect(formatBody("{{ firstName }} {{{firstName}}}", contact)).toBe("Ana Ana");
  });

  // Attendants paste code: Mustache threw on sections and blanked unknown tags.
  it("keeps code and unknown tags as typed", () => {
    const code = "{{#each items}}<b>{{this}}</b>{{/each}} {{ item.name }} {{/if}} {{! x <div style={{color: 1}}> {{nome}}";
    expect(formatBody(code, contact)).toBe(code);
    expect(formatBody("{{{ a }} {{=<% %>=}} {{> parcial}}", contact)).toBe("{{{ a }} {{=<% %>=}} {{> parcial}}");
  });
});

describe("matchesTemplate", () => {
  it("recognizes a message sent from the template", () => {
    const template = "Olá {{firstName}}, protocolo {{protocol}}.";
    expect(matchesTemplate(formatBody(template, contact), template)).toBe(true);
  });

  it("rejects a different message", () => {
    expect(matchesTemplate("Pode me ajudar?", "Olá {{firstName}}!")).toBe(false);
  });

  it("treats regex characters in the template as text", () => {
    expect(matchesTemplate("Preço (R$ 10) ok? Oi Ana", "Preço (R$ 10) ok? Oi {{firstName}}")).toBe(true);
  });
});

describe("contact and date variables", () => {
  const ana = { id: 7, name: "Ana Maria Souza", number: "5531999990000", email: "ana@x.com" } as Contact;

  it("fills the contact fields", () => {
    expect(formatBody("{{firstName}}|{{lastName}}|{{phoneNumber}}|{{email}}|{{contactId}}", ana)).toBe(
      "Ana|Souza|5531999990000|ana@x.com|7"
    );
    expect(formatBody("[{{lastName}}]", { name: "Ana" } as Contact)).toBe("[]");
  });

  it("uses Brasília time whatever the server timezone", () => {
    // 2024-10-21 00:30 UTC = Sunday 2024-10-20 21:30 in Brasília.
    jest.useFakeTimers("modern").setSystemTime(new Date("2024-10-21T00:30:05Z"));
    expect(formatBody("{{ms}}|{{greeting}}|{{hour}}|{{date}}|{{dayPeriod}}|{{data_hora}}", ana)).toBe(
      "Boa noite|Boa noite, Ana|21:30:05|20-10-2024|noite|20-10-2024 às 21:30"
    );
    expect(formatBody("{{fullDate}}", ana)).toBe("Domingo, 20-10-2024");
  });

  it("keeps the older names", () => {
    jest.useFakeTimers("modern").setSystemTime(new Date("2024-10-21T12:00:00Z"));
    expect(formatBody("{{gretting}} {{hora}}", ana)).toBe("Bom dia 09:00:00");
  });
});

describe("formatForTicket", () => {
  const ticket = { id: 42, status: "open", userId: 1, queueId: 2, whatsappId: 3, companyId: 4, contact: { name: "Ana Souza" } } as unknown as Ticket;

  it("fills the ticket, attendant, queue, connection and company", async () => {
    jest.spyOn(User, "findByPk").mockResolvedValue({ name: "Carlos" } as any);
    jest.spyOn(Queue, "findByPk").mockResolvedValue({ name: "Vendas" } as any);
    jest.spyOn(Whatsapp, "findByPk").mockResolvedValue({ name: "Comercial" } as any);
    jest.spyOn(Company, "findByPk").mockResolvedValue({ name: "Wazzy", email: "oi@wazzy.com.br", dueDate: "2093-03-14" } as any);
    jest.spyOn(Message, "findOne").mockResolvedValue({ body: "Quero um orçamento" } as any);

    const text = await formatForTicket(
      "{{firstName}}, #{{formattedTicketId}} ({{ticket_id}}) {{ticketStatus}} com {{user}} na {{queue}} pela {{connection}}: {{lastMessage}} | {{name_company}} {{companyEmail}} {{companyDueDate}}",
      ticket
    );
    expect(text).toBe(
      "Ana, #000042 (42) Em atendimento com Carlos na Vendas pela Comercial: Quero um orçamento | Wazzy oi@wazzy.com.br 14-03-2093"
    );
  });

  it("does not query anything for a text without variables", async () => {
    const find = jest.spyOn(User, "findByPk");
    expect(await formatForTicket("Obrigado!", ticket)).toBe("Obrigado!");
    expect(find).not.toHaveBeenCalled();
  });
});

describe("matchesTemplate exact", () => {
  it("compares the whole text", () => {
    expect(matchesTemplate("obrigado, ana!", "obrigado, {{firstname}}!", true)).toBe(true);
    expect(matchesTemplate("obrigado, ana! volte sempre", "obrigado, {{firstname}}!", true)).toBe(false);
  });
});

describe("formatForCampaign", () => {
  it("fills the list contact, company and connection, keeping single-brace text", async () => {
    jest.spyOn(Company, "findByPk").mockResolvedValue({ name: "Wazzy", email: "oi@wazzy.com.br", dueDate: "2093-03-14" } as any);
    const text = await formatForCampaign("{{greeting}}! {{lastName}} {{phoneNumber}} | {{name_company}} via {{connection}} {nome}", {
      contact: { name: "Ana Souza", number: "5531999990000", email: "ana@x.com" },
      companyId: 1,
      connectionName: "Comercial"
    });
    expect(text).toMatch(/^(Bom dia|Boa tarde|Boa noite|Boa madrugada), Ana! Souza 5531999990000 \| Wazzy via Comercial \{nome\}$/);
  });
});
