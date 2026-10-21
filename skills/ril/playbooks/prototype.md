# Prototype

Goal: the person settles a screen's look before the brief is confirmed. Called from design; skipped on "leave the look to me" at intake (the brief describes the look in words).

## Checks

- **Variants**, by an author, `.ril/docs/mockups/`: two or three throwaway variants of the screen, each labeled, behind one switcher; the lightest thing that renders, no framework, no tests. A text-only interface sketches as plain text. Mark them throwaway; never ship or copy them into the product.
- **Show them** in the person's browser through an approved tool; with none approved, say in plain words which file to open (part of the "Tools I will use" question).
- **Verify what you show**: screenshot each variant on its surface (`skills/ril/references/proof-kit.md`),, for the person and the record.
- **Loop**, one plain question per round, showing pictures or the page, never code or paths. The person may pick one, ask for changes ("make the list denser"), describe their own idea, or mix parts; revise (edit a variant or build new ones) and show again until they say "this is it". At any point "you decide": pick, say what you picked, move on.
- **Finish**: `ril decision log --stage design --decision "Look chosen: <their words>" --why "<why>"`; write the look into each visual scenario's criteria before confirm (`ril scenario update <id> --criterion "<text>"` once imported); save the chosen screenshot under `.ril/docs/mockups/chosen/`; give each visual scenario's feature map that screenshot as what the real screen is compared against.

## Evidence required for done

- The person said "this is it", or "you decide".
- The decision is logged.
- The chosen screenshot exists under `.ril/docs/mockups/chosen/`.
- The criteria mention the chosen look.
- The feature maps name the screenshot the real build is compared against.
