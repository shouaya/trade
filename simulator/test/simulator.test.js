const suites = [
  { label: 'core', cases: require('./core.test.js') },
  { label: 'pricing', cases: require('./pricing.test.js') },
  { label: 'fees', cases: require('./fees.test.js') },
  { label: 'trading scenarios', cases: require('./trading-scenarios.test.js') },
  { label: 'golden', cases: require('./golden.test.js') },
  { label: 'exports', cases: require('./exports.test.js') },
];

function run() {
  for (const suite of suites) {
    for (const testCase of suite.cases) {
      testCase.run();
    }
  }

  console.log('simulator tests passed');
}

run();
