// Test-process-only provider fixture. Production code has no test bypass or fake summary path.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'www.nseindia.com' && url.pathname === '/api/corporate-announcements') {
    const symbol = url.searchParams.get('symbol');
    const rows = [
      { symbol, sm_name: 'Document Test Company', desc: 'Receipt of orders', attchmntText: 'Contract announcement', seq_id: 'docs-e2e-order', an_dt: '02-Nov-2026 12:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/docs-e2e-order.pdf' },
      { symbol, sm_name: 'Document Test Company', desc: 'Change in management', attchmntText: 'New CFO', seq_id: 'docs-e2e-management', an_dt: '01-Nov-2026 12:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/docs-e2e-management.pdf' },
      { symbol, sm_name: 'Document Test Company', desc: 'Investor meeting', attchmntText: 'Routine analyst meeting schedule', seq_id: 'docs-e2e-meeting', an_dt: '01-Nov-2026 11:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/docs-e2e-meeting.pdf' },
      { symbol, sm_name: 'Document Test Company', desc: 'Trading window closure', attchmntText: 'Routine', seq_id: 'docs-e2e-routine', an_dt: '01-Nov-2026 10:00:00', attchmntFile: 'https://nsearchives.nseindia.com/corporate/docs-e2e-routine.pdf' }
    ];
    return Response.json(rows.map((row) => ({ ...row, seq_id: `${symbol}-${row.seq_id}` })));
  }
  if (url.hostname === 'api.openai.com' && url.pathname === '/v1/responses') {
    const request = JSON.parse(init.body);
    if (request.model !== 'gpt-5.6-luna') throw new Error('Unexpected AI model');
    const pdf = request.input[0].content.find((item) => item.type === 'input_file')?.file_url;
    if (!pdf) throw new Error('Original PDF missing from summary request');
    const management = pdf.includes('management');
    const routine = pdf.includes('meeting');
    const analysis = { important: !routine, category: management ? 'Management' : routine ? 'Other material updates' : 'Order wins', takeaway: management ? 'A new chief financial officer was appointed.' : routine ? 'An analyst meeting was scheduled.' : 'The company secured a new manufacturing contract.', summary: management ? 'The CFO appointment takes effect on 1 November 2026 (page 1).' : 'The contract is worth INR 100 crore and is scheduled for execution over twelve months (page 1). Payment terms were not disclosed.' };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] });
  }
  return originalFetch(input, init);
};
