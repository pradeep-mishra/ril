Method: <the scenario's method, exactly as ril scenario list shows it>
Covers: <the files this proof relies on, relative to the project and comma separated, or "none yet">
Synced at: <the saved version this map was last confirmed at, or "none yet">
<!-- Feature map for one scenario, saved as .ril/docs/verification/feature-map/<id>.md. Keep the first three lines first; fill every part; delete this line. -->
# <id>: <the scenario's title>

## Sub-features
- <Each separate thing the criterion promises, one per line, with its pass condition: the exact output, file or exit code that must be seen.>

## How to get to it
- <From nothing to the starting point, the way a person gets there: how the program is installed in a clean temporary folder, what state it starts from.>

## Driving it
- <Each command to run, with its input and the expected stdout, stderr and exit code, word for word where the criterion names them.>
- <The break-it runs: a missing argument, a bad value, empty input, running it twice, interrupting it; what must happen for each.>
- <The evidence file this saves: .ril/evidence/<id>/<saved version>/transcript.txt.>
- <For a promise the design lists under "Where a bug would cost the most": the property-based or generated-input test that checks it, and its command.>

## Gotchas
- <What could make this proof lie (leftover files, the person's own settings, timing, the network) and how the run avoids it, or "None found.">
