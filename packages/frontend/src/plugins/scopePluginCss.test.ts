import { describe, it, expect } from 'vitest';
import { scopePluginCss } from './pluginModuleCache';

const SCOPE = '[data-oscarr-plugin="radarr"]';

describe('scopePluginCss', () => {
  it('scopes a plain rule', () => {
    expect(scopePluginCss('.a{color:red}', SCOPE)).toBe(`${SCOPE} .a{color:red}`);
  });

  it('scopes each selector in a list', () => {
    expect(scopePluginCss('.a,.b{color:red}', SCOPE)).toBe(`${SCOPE} .a,${SCOPE} .b{color:red}`);
  });

  // The regression: prefixing an at-rule prelude produced `@<scope> media (...){`, which browsers
  // discard along with every rule inside it — silently killing all responsive plugin utilities.
  it('leaves a media query prelude intact and scopes the rules inside it', () => {
    const out = scopePluginCss('@media (min-width:1024px){.lg\\:grid-cols-5{color:red}}', SCOPE);
    expect(out).toBe(`@media (min-width:1024px){${SCOPE} .lg\\:grid-cols-5{color:red}}`);
    expect(out).not.toContain(`@${SCOPE}`);
  });

  it('does not mangle @supports or @layer preludes', () => {
    expect(scopePluginCss('@supports (display:grid){.a{color:red}}', SCOPE))
      .toBe(`@supports (display:grid){${SCOPE} .a{color:red}}`);
    expect(scopePluginCss('@layer utilities{.a{color:red}}', SCOPE))
      .toBe(`@layer utilities{${SCOPE} .a{color:red}}`);
  });

  it('leaves keyframe steps alone but keeps the @keyframes prelude valid', () => {
    const out = scopePluginCss('@keyframes fadeIn{0%{opacity:0}to{opacity:1}}', SCOPE);
    expect(out).toBe('@keyframes fadeIn{0%{opacity:0}to{opacity:1}}');
  });

  it('scopes rules that follow a media block', () => {
    const out = scopePluginCss('@media (min-width:640px){.a{color:red}}.b{color:blue}', SCOPE);
    expect(out).toBe(`@media (min-width:640px){${SCOPE} .a{color:red}}${SCOPE} .b{color:blue}`);
  });

  // The second regression: splitting the selector list on every comma cut inside functional
  // pseudo-classes, so `:is(.compact,.wide)` came out as two broken halves.
  it('does not split inside :is() / :where() / :not()', () => {
    expect(scopePluginCss('.card:is(.compact,.wide){color:red}', SCOPE))
      .toBe(`${SCOPE} .card:is(.compact,.wide){color:red}`);
    expect(scopePluginCss(':where(.a,.b) .c{color:red}', SCOPE))
      .toBe(`${SCOPE} :where(.a,.b) .c{color:red}`);
    expect(scopePluginCss('.x:not(.y,.z){color:red}', SCOPE))
      .toBe(`${SCOPE} .x:not(.y,.z){color:red}`);
  });

  it('does not split inside an attribute value', () => {
    expect(scopePluginCss('[data-list="a,b"]{color:red}', SCOPE))
      .toBe(`${SCOPE} [data-list="a,b"]{color:red}`);
  });

  it('still splits the commas that separate real selectors', () => {
    expect(scopePluginCss('.a:is(.x,.y),.b{color:red}', SCOPE))
      .toBe(`${SCOPE} .a:is(.x,.y),${SCOPE} .b{color:red}`);
  });

  it('handles nested parentheses', () => {
    expect(scopePluginCss('.a:is(.b:not(.c,.d),.e){color:red}', SCOPE))
      .toBe(`${SCOPE} .a:is(.b:not(.c,.d),.e){color:red}`);
  });

  it('scopes a keyframes-like step list only when every part is a step', () => {
    expect(scopePluginCss('@keyframes k{0%,100%{opacity:0}}', SCOPE))
      .toBe('@keyframes k{0%,100%{opacity:0}}');
  });
});
