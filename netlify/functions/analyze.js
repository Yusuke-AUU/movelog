exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { imageBase64, mediaType } = JSON.parse(event.body);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${imageBase64}` }
            },
            {
              type: 'text',
              text: 'この食事の写真を見て、各料理の名前と推定カロリーを日本語で答えてください。最後に合計カロリーを「合計: XXXkcal」の形式で書いてください。簡潔に箇条書きで。'
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || 'OpenAI APIエラー' })
      };
    }

    // script.jsのパース処理と同じ形式で返す
    const text = data.choices?.[0]?.message?.content || '分析できませんでした';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [{ type: 'text', text }]
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
