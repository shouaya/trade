type TestCase = {
  readonly name: string;
  readonly fn: () => void | Promise<void>;
};

const testCases: TestCase[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  testCases.push({ name, fn });
}

async function run(): Promise<void> {
  let failures = 0;

  for (const testCase of testCases) {
    try {
      await testCase.fn();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${testCase.name}`);
      console.error(error);
    }
  }

  console.log(`\n${testCases.length} tests, ${failures} failures`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  test,
  run
};
