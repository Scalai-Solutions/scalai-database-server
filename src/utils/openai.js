const OpenAI = require('openai');
const Logger = require('./logger');
const config = require('../../config/config');

class OpenAIHelper {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || config.openai?.apiKey
    });
  }

  /**
   * Generate a short, descriptive title for a document filename
   * @param {string} filename - The document filename
   * @param {number} fileSize - File size in bytes
   * @returns {Promise<string>} Generated title
   */
  async generateDocumentTitle(filename, fileSize = 0) {
    try {
      // Remove file extension and numbers/dates for context
      const cleanName = filename
        .replace(/\.[^/.]+$/, '') // Remove extension
        .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
        .replace(/\d{8,}/g, '') // Remove long number sequences
        .trim();

      const prompt = `Generate a short, descriptive title (max 50 characters) for a document with this filename: "${cleanName}". 
The title should be professional, clear, and describe what the document might contain based on the filename.
Only return the title, nothing else.`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that creates concise, professional document titles.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.7
      });

      const title = response.choices[0].message.content.trim();
      Logger.info('Generated document title', { filename, generatedTitle: title });
      return title;
    } catch (error) {
      Logger.error('Failed to generate document title with OpenAI', {
        filename,
        error: error.message
      });
      // Fallback to cleaned filename
      return filename
        .replace(/\.[^/.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/\d+/g, '')
        .trim()
        .substring(0, 50) || 'Document';
    }
  }

  /**
   * Generate a short, descriptive title for a URL
   * @param {string} url - The URL
   * @returns {Promise<string>} Generated title
   */
  async generateURLTitle(url) {
    try {
      const prompt = `Generate a short, descriptive title (max 50 characters) for this URL: "${url}". 
The title should describe what the website/page is about based on the domain and path.
Only return the title, nothing else.`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that creates concise, professional titles for URLs.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.7
      });

      const title = response.choices[0].message.content.trim();
      Logger.info('Generated URL title', { url, generatedTitle: title });
      return title;
    } catch (error) {
      Logger.error('Failed to generate URL title with OpenAI', {
        url,
        error: error.message
      });
      // Fallback to domain name
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '').substring(0, 50);
      } catch {
        return 'Website';
      }
    }
  }

  /**
   * Generate a short title for text content
   * @param {string} text - The text content
   * @returns {Promise<string>} Generated title
   */
  async generateTextTitle(text) {
    try {
      const prompt = `Generate a short, descriptive title (max 50 characters) for this text content: "${text.substring(0, 500)}". 
The title should summarize what the text is about.
Only return the title, nothing else.`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that creates concise titles for text content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.7
      });

      const title = response.choices[0].message.content.trim();
      Logger.info('Generated text title', { textLength: text.length, generatedTitle: title });
      return title;
    } catch (error) {
      Logger.error('Failed to generate text title with OpenAI', {
        error: error.message
      });
      // Fallback to first few words
      return text.substring(0, 50).trim() || 'Text Content';
    }
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getOpenAIHelper: () => {
    if (!instance) {
      instance = new OpenAIHelper();
    }
    return instance;
  }
};

