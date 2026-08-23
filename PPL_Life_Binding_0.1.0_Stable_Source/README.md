# @ppl/host-binding-life 0.1.0 Stable

Application-driven Life binding candidate after real R1 LM Studio evidence.

RC4 changes only the Life request/response binding:
- action is a discriminated JSON contract;
- `life-preference-proposal` must carry `{key,value}`;
- `life-plan-proposal` must carry `{plan}`;
- `life-escalation` must carry `{required:true,reason}`;
- citations may contain only exact Host `realtimeFacts[].locator` strings; with no realtime facts, citations must be `[]`.

It does not modify PPL Core, Runtime, Profiles, or Host 0.1.6 Stable.
