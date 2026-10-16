export interface TemplateInput {
  business: string;
  offer: string;
  audience: string;
}

export interface EmailTemplate {
  id: string;
  subject: string;
  body: string;
  tone: string;
}

/**
 * TODO: Replace this stub with a real AI API call (e.g., Google Gemini, OpenAI GPT-4).
 * Send the business, offer, and audience to the LLM and parse 3 template variations.
 */
export async function generateTemplates(input: TemplateInput): Promise<EmailTemplate[]> {
  // STUB: Returns hardcoded template variations for demonstration
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const { business, offer, audience } = input;
  return [
    {
      id: '1',
      tone: 'Professional',
      subject: `A special offer from ${business}`,
      body: `Hi {{name}},\n\nWe hope this message finds you well.\n\nAt ${business}, we are excited to offer ${audience} an exclusive opportunity: ${offer}.\n\nThis offer is available for a limited time, and we would love for you to take advantage of it.\n\nVisit our website or reply to this email to learn more.\n\nBest regards,\nThe ${business} Team\n123 Business St, City, State 00000\n\nTo unsubscribe from our emails, reply with 'Unsubscribe' or click here: [Unsubscribe].`,
    },
    {
      id: '2',
      tone: 'Friendly',
      subject: `Hey {{name}}, we have something for you 🎉`,
      body: `Hi {{name}},\n\nQuick note from the team at ${business} — we thought you would love this.\n\nWe are offering ${audience} something special: ${offer}.\n\nNo strings attached. We just think it is a great fit for you.\n\nInterested? Just hit reply and we will get you sorted.\n\nTalk soon,\n${business}\n123 Business St, City, State 00000\n\nDon't want to hear from us? No worries — unsubscribe here: [Unsubscribe].`,
    },
    {
      id: '3',
      tone: 'Direct',
      subject: `${offer} — just for ${audience}`,
      body: `Hi {{name}},\n\n${business} is offering ${audience}: ${offer}.\n\nHere is what you get:\n- Immediate access\n- No hidden fees\n- Full support from our team\n\nReply to claim or click the link below.\n\n— ${business}\n123 Business St, City, State 00000\n\nUnsubscribe: [Unsubscribe Link]`,
    },
  ];
}
