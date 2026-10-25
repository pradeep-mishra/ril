# Prototype

## Checks

- **Variants**, by an author, `.ril/docs/mockups/`: two or three throwaway variants of the screen, each labeled, behind one switcher; the lightest thing that renders, no tests; plain text for a text-only interface. Never ship them.
- **Show them** in the person's browser through an approved tool, else say which file to open.
- **Verify what you show**: screenshot each variant on its surface (`skills/ril/references/proof-kit.md`).
- **Loop**, showing pictures or the page: revise and show again until "this is it". On "you decide": pick, say what, move on.
- **Finish**: `ril decision log --stage design --decision "Look chosen: <their words>" --why "<why>"`; write the look into each visual scenario's criteria (`ril scenario update <id> --criterion "<text>"` once imported); save the chosen screenshot under `.ril/docs/mockups/chosen/` and name it in each visual scenario's feature map as what the real screen is compared against.

## Evidence required for done

- The person said "this is it", or "you decide".
- The chosen screenshot exists under `.ril/docs/mockups/chosen/`.
- The criteria and feature maps name the chosen look and screenshot.
