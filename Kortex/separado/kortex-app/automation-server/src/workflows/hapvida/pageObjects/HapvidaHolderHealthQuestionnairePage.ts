import type { Page } from "playwright";
import { AutomationError } from "../../../errors.js";
import type { HealthAnswer } from "../inclusionUtils.js";

export class HapvidaHolderHealthQuestionnairePage {
  constructor(private readonly page: Page) {}

  heading() {
    return this.page.getByText(/question[aá]rio\s+de\s+sa[uú]de|declara[cç][aã]o\s+de\s+sa[uú]de/i).first();
  }

  async waitForLoaded() {
    await this.heading().waitFor({ state: "visible" });
  }

  async answerAllNo() {
    const noOptions = this.page.getByLabel(/^n[aã]o$/i);
    const count = await noOptions.count();
    if (count === 0) {
      throw new AutomationError("PORTAL_CHANGED", "Alternativas negativas do questionario nao encontradas.", {
        safeDetails: "Nao localizei os campos 'Nao' do questionario de saude por label semantico.",
        step: "filling_health_questionnaire",
        retryable: false,
      });
    }

    for (let index = 0; index < count; index += 1) {
      const option = noOptions.nth(index);
      if (await option.isVisible().catch(() => false)) {
        await option.check({ force: true }).catch(() => option.click({ force: true }));
      }
    }
  }

  async answerQuestions(answers: HealthAnswer[]) {
    for (const answer of answers) {
      const group = this.questionGroup(answer.questionId);
      const option = group.getByLabel(answer.answer === "yes" ? /^sim$/i : /^n[aã]o$/i).first();
      if (!(await option.isVisible().catch(() => false))) {
        throw new AutomationError("PORTAL_CHANGED", "Pergunta do questionario de saude nao encontrada.", {
          safeDetails: `Nao localizei a pergunta ${answer.questionId} no questionario.`,
          step: "filling_health_questionnaire",
          retryable: false,
        });
      }

      await option.check({ force: true }).catch(() => option.click({ force: true }));
      if (answer.answer === "yes" && answer.detail?.trim()) {
        await group.locator("textarea,input[type='text']").last().fill(answer.detail.trim());
      }
    }
  }

  proceedButton() {
    return this.page
      .getByRole("button", { name: /prosseguir|avancar|avançar|continuar|revisar/i })
      .or(this.page.locator("input[value*='PROSSEGUIR' i], input[value*='AVANCAR' i], input[value*='AVANÇAR' i], input[value*='CONTINUAR' i], input[value*='REVISAR' i]").first());
  }

  async proceed() {
    await this.proceedButton().click();
  }

  private questionGroup(questionId: string) {
    return this.page
      .locator(`[data-question-id="${questionId}"], [id*="${questionId}"], [name*="${questionId}"]`)
      .or(this.page.getByText(new RegExp(questionId, "i")).locator("xpath=ancestor::*[self::tr or self::fieldset or self::div][1]"))
      .first();
  }
}
