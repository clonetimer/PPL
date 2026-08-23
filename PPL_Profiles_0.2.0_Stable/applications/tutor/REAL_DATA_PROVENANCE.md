# Tutor Real-data Provenance — 0.2.0 Stable

The real trace fixture first introduced during the RC2 application gate is not synthetic. It contains selected rows from the public corrected ASSISTments 2009–2010 Skill Builder mirror:

- repository: `sjsarsa/kt-data-fiddler`
- commit: `9f653389eebd8129160507c1cfb611cb317cd18e`
- path: `tests/data/assistments2009-skill-builders-corrected_1000.csv`
- selected users: `70363`, `70729`
- selected skill: `Box and Whisker`
- selected rows: 11

The official ASSISTments site remains the semantic source of truth for field interpretation and corrected-data provenance. This environment could inspect the official page but did not byte-fetch the Google Drive original, so the validation report labels the fixture `public-corrected-mirror-subset` rather than claiming official-byte identity.

The selected rows preserve original `order_id`, `user_id`, `problem_id`, `skill_name`, `correct`, `attempt_count`, `hint_count`, `bottom_hint`, `original`, and related fields.
