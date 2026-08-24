// SHARED ASSERTIONS for the probe suite.
//
// Ola: "probes must assert what a PLAYER would notice, not what a
// variable does." The first half of that is this file: before it, most
// probes printed numbers and exited 0 whatever the numbers said, so a red
// run and a green run were indistinguishable to anything reading an exit
// code, including a person scrolling past.
//
// The second half is not something a helper can enforce. Every check
// written with this should name a thing you could SEE happen.
export function probe(name) {
  let fails = 0, checks = 0;
  const errors = [];
  return {
    errors,
    // `detail` prints on pass AND fail, so phrase it as a measurement
    // ("biggest lip 0.24 m, limit 0.45"), never as an accusation.
    check(ok, label, detail = '') {
      checks++;
      if (!ok) fails++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
      return ok;
    },
    // For numbers worth printing that are not themselves a claim.
    note(msg) { console.log(`       ${msg}`); },
    // Call last. Page errors count as failures: an exception during play
    // is a bug whether or not any assertion noticed.
    finish() {
      const total = fails + errors.length;
      if (errors.length) console.log('errors:', errors.slice(0, 3).join(' | '));
      console.log(total
        ? `\n${name} RED (${total} of ${checks})`
        : `\n${name} GREEN (${checks} checks)`);
      process.exit(total ? 1 : 0);
    },
  };
}
