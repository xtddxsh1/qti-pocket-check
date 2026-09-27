'use strict';
(() => {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const summary = () => {
    const report = window.QTIPocketCheck.getReport();
    return report ? {version: report.version, complete: report.complete, summary: report.summary, codes: report.diagnostics.map(d => d.code), limitations: report.limitations} : {status: 'no_report'};
  };
  const tools = [{
    name: 'read_check_summary', title: 'Read current check summary',
    description: 'Read counts and diagnostic codes from the current visible check. Does not expose question text, paths, or IDs.',
    inputSchema: {type:'object', properties:{}, additionalProperties:false},
    annotations: {readOnlyHint:true, untrustedContentHint:true},
    execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.');
      return summary();
    }
  }, {
    name: 'run_synthetic_check', title: 'Run a synthetic sample',
    description: 'Replace the visible report with a check of an original synthetic good or bad ZIP. Never reads a personal file.',
    inputSchema: {type:'object', properties:{sample:{type:'string', enum:['good','bad']}}, required:['sample'], additionalProperties:false},
    annotations: {readOnlyHint:false, untrustedContentHint:false},
    async execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !['good','bad'].includes(input.sample)) throw new Error('Choose sample good or bad.');
      if (window.QTIPocketCheck.isRunning()) throw new Error('A check is already running.');
      await window.QTIPocketCheck.runSynthetic(input.sample);
      return summary();
    }
  }];
  for (const tool of tools) {
    try { Promise.resolve(context.registerTool(tool, {signal:lifecycle.signal})).catch(() => {}); }
    catch { /* Optional browser integration must not break the checker. */ }
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), {once:true});
})();
