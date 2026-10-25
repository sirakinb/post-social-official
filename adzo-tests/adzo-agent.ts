import type { StepExecutor } from 'e2e';

// AI steps (agent.act, agent.assert) answered by Adzo on Aki's Claude plan.
// Each turn sends the screen to Adzo, which picks one move; e2e performs it
// with its checked, recorded actions, so a passing step replays next time
// without asking again. Written by Adzo; edits here are replaced.
const MAX_TURNS = 20;
const VERBS = ['tap', 'type', 'typeSecret', 'press', 'select', 'check', 'scroll', 'scrollTo', 'hover', 'navigate', 'back'];

export const adzoExecutor: StepExecutor = {
  name: 'adzo',
  version: '1',
  vision: true,
  async runStep(ctx) {
    const url = process.env.ADZO_AGENT_URL;
    const token = process.env.ADZO_AGENT_TOKEN;
    if (!url || !token) return { status: 'blocked', errorCode: 'MODEL_UNAVAILABLE', summary: 'Adzo is not connected for AI steps.' };
    const verbs = VERBS.filter((v) => ctx.target.verbs.has(v as never));
    const history: string[] = ctx.replayedPrefix ? ['Some of this step already ran from memory. Carry on from the current screen.'] : [];
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      if (ctx.signal.aborted) return { status: 'blocked', errorCode: 'CANCELLED', summary: 'Cancelled.' };
      const screen = await ctx.observe({ pixels: true });
      let d: any = null;
      let problem = '';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          signal: ctx.signal,
          body: JSON.stringify({
            kind: ctx.step.kind,
            instruction: ctx.step.instruction,
            params: ctx.step.params ?? null,
            screen: screen.text,
            url: screen.path ?? null,
            image: screen.pixels ? Buffer.from(screen.pixels.data).toString('base64') : null,
            history,
            verbs,
            secrets: ctx.step.secrets.map((s) => s.name),
          }),
        });
        if (res.ok) d = await res.json();
        else problem = 'Adzo answered ' + res.status;
      } catch (err) {
        problem = (err as Error).message;
      }
      ctx.budgets.recordModelCall();
      if (!d) return { status: 'blocked', errorCode: 'MODEL_PROVIDER_FAILED', summary: "Adzo couldn't decide this step: " + problem };
      if (d.done) return d.status === 'passed' ? { status: 'passed', summary: d.summary || 'Done.' } : { status: 'failed', summary: d.summary || 'It did not work.' };
      const a = d.action ?? {};
      const target = { id: String(a.id ?? '') };
      try {
        switch (a.verb) {
          case 'tap': await ctx.actions.tap(target); break;
          case 'type': await ctx.actions.type(target, String(a.text ?? '')); break;
          case 'typeSecret': await ctx.actions.typeSecret(target, String(a.name ?? '')); break;
          case 'press': await ctx.actions.press(target, String(a.key ?? 'Enter')); break;
          case 'select': await ctx.actions.select(target, String(a.value ?? '')); break;
          case 'check': await ctx.actions.check(target, a.checked !== false); break;
          case 'scroll': await ctx.actions.scroll(a.direction === 'up' ? 'up' : 'down', a.id ? target : undefined); break;
          case 'scrollTo': await ctx.actions.scrollTo(target); break;
          case 'hover': await ctx.actions.hover(target); break;
          case 'navigate': await ctx.actions.navigate(String(a.url ?? '')); break;
          case 'back': await ctx.actions.back(); break;
          default:
            history.push('Turn ' + turn + ': "' + a.verb + '" is not a verb you can use.');
            continue;
        }
        history.push('Turn ' + turn + ': ' + a.verb + (a.id ? ' #' + a.id : '') + (a.text ? ' ' + JSON.stringify(a.text) : '') + ' worked.' + (a.why ? ' (' + a.why + ')' : ''));
      } catch (err) {
        history.push('Turn ' + turn + ': ' + a.verb + (a.id ? ' #' + a.id : '') + ' failed: ' + String((err as Error).message).slice(0, 300));
      }
    }
    return { status: 'blocked', errorCode: 'STEP_NO_CONCLUSION', summary: 'No conclusion after ' + MAX_TURNS + ' moves.' };
  },
};
