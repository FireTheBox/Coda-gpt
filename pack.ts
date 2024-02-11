import * as coda from '@codahq/packs-sdk';

export const pack = coda.newPack();

const DEFAULT_MODEL = 'text-ada-001';

pack.setUserAuthentication({
  type: coda.AuthenticationType.HeaderBearerToken,
  instructionsUrl: 'https://platform.openai.com/account/api-keys',
});

pack.addNetworkDomain('openai.com');

interface CompletionsRequest {
  model: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

interface ChatCompletionMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
}

function isChatCompletionModel(model: string): boolean {
  // Também funciona com modelos de snapshot como `gpt-3.5-turbo-0301` e `gpt-4-0314`
  return model.includes('gpt-3.5-turbo') || model.includes('gpt-4');
}

async function getChatCompletion(context: coda.ExecutionContext, request: ChatCompletionRequest): Promise<string> {
  const resp = await context.fetcher.fetch({
    url: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    body: JSON.stringify(request),
    headers: {'Content-Type': 'application/json'},
  });
  return resp.body.choices[0].message.content.trim();
}

async function getCompletion(context: coda.ExecutionContext, request: CompletionsRequest): Promise<string> {
  try {
    // Chama a API de conclusão de chat se o modelo for um modelo de conclusão de chat.
    if (isChatCompletionModel(request.model)) {
      return getChatCompletion(context, {
        model: request.model,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        messages: [{role: 'user', content: request.prompt}],
      });
    }

    const resp = await context.fetcher.fetch({
      url: 'https://api.openai.com/v1/completions',
      method: 'POST',
      body: JSON.stringify(request),
      headers: {'Content-Type': 'application/json'},
    });
    return resp.body.choices[0].text.trim();
  } catch (err: any) {
    if (err.statusCode === 429 && err.type === 'insufficient_quota') {
      throw new coda.UserVisibleError(
        "Você excedeu sua cota atual da API OpenAI. Verifique seu plano e detalhes de faturamento. Para obter ajuda, consulte https://help.openai.com/en/articles/6891831-error-code-429-you-exceeded-your-current-quota-please-check-your-plan-and-billing-details",
      );
    }

    throw err;
  }
}

const promptParam = coda.makeParameter({
  type: coda.ParameterType.String,
  name: 'prompt',
  description: 'prompt',
});

const modelParameter = coda.makeParameter({
  type: coda.ParameterType.String,
  name: 'model',
  description:
    "o modelo GPT-3 para processar sua solicitação. Se você não especificar um modelo, o padrão será text-ada-001, que é o mais rápido e de menor custo. Para geração de maior qualidade, considere text-davinci-003. Para mais informações, veja https://platform.openai.com/docs/models/overview.",
  optional: true,
  autocomplete: async () => {
    return [
      'text-davinci-003',
      'text-davinci-002',
      'text-curie-001',
      'text-babbage-001',
      'text-ada-001',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
      'gpt-4',
      'gpt-4-32k',
    ];
  },
});

const numTokensParam = coda.makeParameter({
  type: coda.ParameterType.Number,
  name: 'numTokens',
  description:
    'o número máximo de tokens para a conclusão ser gerada. O padrão é 512. Máximo de 2.048 para a maioria dos modelos e 4.000 para davinci',
  optional: true,
});

const temperatureParam = coda.makeParameter({
  type: coda.ParameterType.Number,
  name: 'temperature',
  description:
    'a temperatura de quão criativo o GPT-3 é com a conclusão. Deve estar entre 0,0 e 1,0. O padrão é 1.0..',
  optional: true,
});

const systemPromptParam = coda.makeParameter({
  type: coda.ParameterType.String,
  name: 'systemPrompt',
  description: "Opcional. Ajuda a definir o comportamento do assistente. por exemplo. 'Você é um assistente prestativo.'",
  optional: true,
});

const stopParam = coda.makeParameter({
  type: coda.ParameterType.StringArray,
  name: 'stop',
  description: 'Opcional. Até 4 sequências em que a API irá parar de gerar mais tokens.',
  optional: true,
});

const commonPromptParams = {
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 512, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const request = {
      model,
      prompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);
    return result;
  },
};

pack.addFormula({
  name: 'ChatCompletion',
  description:
    'Recebe prompt como entrada e retorna uma mensagem gerada pelo modelo como saída. Opcionalmente, você pode fornecer uma mensagem do sistema para controlar o comportamento do chatbot.',
  parameters: [promptParam, systemPromptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function (
    [userPrompt, systemPrompt, model = 'gpt-3.5-turbo', maxTokens = 512, temperature, stop],
    context,
  ) {
    coda.assertCondition(isChatCompletionModel(model), 'Deve usar modelos relacionados ao `gpt-3.5-turbo` para esta fórmula.');

    if (userPrompt.length === 0) {
      return '';
    }

    const messages: ChatCompletionMessage[] = [];

    if (systemPrompt && systemPrompt.length > 0) {
      messages.push({role: 'system', content: systemPrompt});
    }

    messages.push({role: 'user', content: userPrompt});

    const request = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stop,
    };

    const result = await getChatCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'GPT3Prompt',
  description: 'Texto completo de um prompt',
  ...commonPromptParams,
  isExperimental: true,
} as any);

pack.addFormula({
  name: 'Prompt',
  description: 'Texto completo de um prompt',
  ...commonPromptParams,
} as any);

pack.addFormula({
  name: 'AnswerPrompt',
  description:
    'Texto completo de um prompt, gera o resultado da ação. Isto só deve ser usado em uma tabela em combinação com a saída do resultado para uma coluna de resultados; caso contrário, não terá efeito.',
  ...commonPromptParams,
  isAction: true,
} as any);

pack.addFormula({
  name: 'GPT3PromptExamples',
  description: 'Texto completo a partir de um prompt e um conjunto de exemplos',
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: 'prompt',
      description: 'prompt',
    }),
    coda.makeParameter({
      type: coda.ParameterType.StringArray,
      name: 'trainingPrompts',
      description: 'Solicitações de exemplo. Deve ter o mesmo comprimento que `trainingResponses`',
    }),
    coda.makeParameter({
      type: coda.ParameterType.StringArray,
      name: 'trainingResponses',
      description: 'Exemplos de respostas correspondentes a `trainingPrompts`. Deve ter o mesmo comprimento',
    }),
    modelParameter,
    numTokensParam,
    temperatureParam,
    stopParam,
  ],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function (
    [prompt, trainingPrompts, trainingResponses, model = DEFAULT_MODEL, max_tokens = 512, temperature, stop],
    context,
  ) {
    coda.assertCondition(
      trainingPrompts.length === trainingResponses.length,
      'Deve ter o mesmo número de prompts de exemplo que de respostas de exemplo',
    );
    if (prompt.length === 0) {
      return '';
    }
    coda.assertCondition(trainingResponses.length > 0, 'Forneça algumas respostas de treinamento');

    const exampleData = trainingPrompts.map((promptEx, i) => `${promptEx}\n${trainingResponses[i]}`).join('```');

    const request = {
      model,
      prompt: exampleData + '```' + prompt + '\n',
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'QuestionAnswer',
  description: 'Responda a uma pergunta, simplesmente forneça uma pergunta em linguagem natural que você possa fazer ao Google ou à Wikipedia',
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 128, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const newPrompt = `Sou um bot de resposta a perguntas altamente inteligente. Se você me fizer uma pergunta que esteja enraizada na verdade, eu lhe darei a resposta. Se você me fizer uma pergunta que seja absurda, enganosa ou que não tenha uma resposta clara, responderei com "Desconhecido".

    P: Qual é a expectativa de vida humana nos Estados Unidos?
    R: A expectativa de vida humana nos Estados Unidos é de 78 anos.
    
    P: Quem era o presidente dos Estados Unidos em 1955?
    R: Dwight D. Eisenhower foi presidente dos Estados Unidos em 1955.
    
    P: A qual partido ele pertencia?
    R: Ele pertencia ao Partido Republicano.
    
    P: Qual é a raiz quadrada da banana?
    R: Desconhecido
    
    P: Como funciona um telescópio?
    R: Os telescópios usam lentes ou espelhos para focar a luz e fazer os objetos parecerem mais próximos.
    
    P: Onde foram realizadas as Olimpíadas de 1992?
    R: As Olimpíadas de 1992 foram realizadas em Barcelona, ​​Espanha.
    
    P: Quantos squigs estão em uma situação difícil?
    R: Desconhecido
P: ${prompt}
R: `;

    const request = {
      model,
      prompt: newPrompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'Summarize',
  description: 'Resuma um grande pedaço de texto',
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 64, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const newPrompt = `${prompt}\ntldr;\n`;

    const request = {
      model,
      prompt: newPrompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'Keywords',
  description: 'Extraia palavras-chave de um grande pedaço de texto',
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 64, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const newPrompt = `Extract keywords from this text:
${prompt}`;

    const request = {
      model,
      prompt: newPrompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'MoodToColor',
  description: 'Gere uma cor para um clima',
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 6, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const newPrompt = `The css code for a color like ${prompt}:
background-color: #`;

    const request = {
      model,
      prompt: newPrompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

pack.addFormula({
  name: 'SentimentClassifier',
  description: 'Categoriza o sentimento do texto em positivo, neutro ou negativo',
  parameters: [promptParam, modelParameter, numTokensParam, temperatureParam, stopParam],
  resultType: coda.ValueType.String,
  onError: handleError,
  execute: async function ([prompt, model = DEFAULT_MODEL, max_tokens = 20, temperature, stop], context) {
    if (prompt.length === 0) {
      return '';
    }

    const newPrompt = `Decida se o sentimento do texto é positivo, neutro ou negativo.
Text: ${prompt}
Sentiment: `;

    const request = {
      model,
      prompt: newPrompt,
      max_tokens,
      temperature,
      stop,
    };

    const result = await getCompletion(context, request);

    return result;
  },
});

const styleParameter = coda.makeParameter({
  type: coda.ParameterType.String,
  name: 'style',
  description:
    "o estilo a ser usado em sua imagem. Se você fornecer isso, não precisará especificar o estilo no prompt",
  optional: true,
  autocomplete: async () => {
    return Object.keys(StyleNameToPrompt);
  },
});

const StyleNameToPrompt = {
  'Cave wall': 'drawn on a cave wall',
  Basquiat: 'in the style of Basquiat',
  'Digital art': 'as digital art',
  Photorealistic: 'in a photorealistic style',
  'Andy Warhol': 'in the style of Andy Warhol',
  'Pencil drawing': 'as a pencil drawing',
  '1990s Saturday morning cartoon': 'as a 1990s Saturday morning cartoon',
  Steampunk: 'in a steampunk style',
  Solarpunk: 'in a solarpunk style',
  'Studio Ghibli': 'in the style of Studio Ghibli',
  'Movie poster': 'as a movie poster',
  'Book cover': 'as a book cover',
  'Album cover': 'as an album cover',
  '3D Icon': 'as a 3D icon',
  'Ukiyo-e': 'in the style of Ukiyo-e',
};

pack.addFormula({
  name: 'CreateDalleImage',
  description: 'Create image from prompt',
  cacheTtlSecs: 60 * 60,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: 'prompt',
      description: 'prompt',
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: 'size',
      description: 'size',
      optional: true,
      autocomplete: async () => {
        return ['256x256', '512x512', '1024x1024'];
      },
    }),
    styleParameter,
    coda.makeParameter({
      type: coda.ParameterType.Boolean,
      name: 'temporaryUrl',
      description: 'Retorne um URL temporário que expira após uma hora. Útil para adicionar a imagem a uma coluna Imagem, porque os URIs de dados padrão são muito longos.',
      optional: true,
    }),
  ],
  resultType: coda.ValueType.String,
  codaType: coda.ValueHintType.ImageReference,
  onError: handleError,
  execute: async function ([prompt, size = '512x512', style, temporaryUrl], context) {
    if (prompt.length === 0) {
      return '';
    }

    const request = {
      size,
      prompt: style ? prompt + ' ' + StyleNameToPrompt[style] ?? style : prompt,
      response_format: temporaryUrl ? 'url' : 'b64_json',
    };

    const resp = await context.fetcher.fetch({
      url: 'https://api.openai.com/v1/images/generations',
      method: 'POST',
      body: JSON.stringify(request),
      headers: {'Content-Type': 'application/json'},
    });
    if (temporaryUrl) {
      return resp.body.data[0].url;
    } else {
      return `data:image/png;base64,${resp.body.data[0].b64_json}`;
    }
  },
});

function handleError(error: Error) {
  if (coda.StatusCodeError.isStatusCodeError(error)) {
   // Converte o erro como StatusCodeError, para melhor intellisense.
    let statusError = error as coda.StatusCodeError;
    let message = statusError.body?.error?.message;

    // Se a API retornou um erro 400 com mensagem, mostre ao usuário.
    if (statusError.statusCode === 400 && message) {
      if (message) {
        throw new coda.UserVisibleError(message);
      }
    }
  }
// A solicitação falhou por algum outro motivo. Relançar o erro para que ele
  // borbulha.
  throw error;
}
