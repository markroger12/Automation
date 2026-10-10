/** Errors with a meaning for the pipeline engine. */

export class LoginRequiredError extends Error {
  constructor(
    public service: 'chatgpt' | 'wordpress',
    message: string,
    public screenshotPath?: string | null,
  ) {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export class TaskCancelledError extends Error {
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'TaskCancelledError';
  }
}

/** The saved ChatGPT conversation cannot be opened: continue in a new chat with a context primer. */
export class ConversationLostError extends Error {
  constructor(message = 'The saved ChatGPT conversation could not be opened.') {
    super(message);
    this.name = 'ConversationLostError';
  }
}

export class UsageLimitError extends Error {
  constructor(message = 'ChatGPT usage limit reached. Try again later.') {
    super(message);
    this.name = 'UsageLimitError';
  }
}

/** A setup problem (missing website, prompt, profile…). Retrying does not help. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** ChatGPT answered an image search without a gallery. */
export class NoImagesError extends Error {
  constructor(message = 'ChatGPT answered the image search without a picture gallery.') {
    super(message);
    this.name = 'NoImagesError';
  }
}

export function isNonRetryable(err: unknown): boolean {
  return err instanceof LoginRequiredError || err instanceof TaskCancelledError || err instanceof ConfigError || err instanceof UsageLimitError;
}
