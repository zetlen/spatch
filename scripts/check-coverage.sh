#!/usr/bin/env bash
# check-coverage.sh — Run unit tests with coverage and enforce thresholds.
# Thresholds are floor values: coverage must meet or exceed them.
#
# Bun has a native coverageThreshold in bunfig.toml, but as of v1.3 it
# enforces per-file (every file must meet the threshold). That's unusable
# here — many files are only exercised by e2e tests, not unit tests.
# This script checks the aggregate "All files" line instead.

MIN_FUNCTIONS=79
MIN_LINES=83

output=$(bun test --coverage 2>&1)
status=$?
echo "$output"

if [ $status -ne 0 ]; then
  exit $status
fi

# Parse the "All files" row: | % Funcs | % Lines |
all_line=$(echo "$output" | grep "All files")
if [ -z "$all_line" ]; then
  echo "ERROR: Could not find coverage summary line"
  exit 1
fi

funcs=$(echo "$all_line" | awk -F'|' '{print $2}' | tr -d ' ')
lines=$(echo "$all_line" | awk -F'|' '{print $3}' | tr -d ' ')

failed=0

if [ "$(echo "$funcs < $MIN_FUNCTIONS" | bc)" -eq 1 ]; then
  echo "FAIL: Function coverage ${funcs}% is below threshold ${MIN_FUNCTIONS}%"
  failed=1
fi

if [ "$(echo "$lines < $MIN_LINES" | bc)" -eq 1 ]; then
  echo "FAIL: Line coverage ${lines}% is below threshold ${MIN_LINES}%"
  failed=1
fi

if [ $failed -eq 0 ]; then
  echo "Coverage OK: functions ${funcs}% >= ${MIN_FUNCTIONS}%, lines ${lines}% >= ${MIN_LINES}%"
fi

exit $failed
