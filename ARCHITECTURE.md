# CompSocrates Architecture

## Team Roles

User documents store `role`, `roles`, `secondaryRoles`, `teamId`, and `isTeamAdmin`. Team admins bypass form role checks. Form-level overrides live on `teams/{teamId}.formAccessOverrides` as `{ [formKey]: uid[] }`.

Core roles are `match-scout`, `pit-scout`, `pit-team`, `drive-team`, `lead-scout`, `lead-strategist`, `team-coach`, `media`, and `judge-awards`.

## Team Administration

`teams/{teamId}` now supports:

```ts
{
  teamName?: string;
  teamNumber?: string;
  verifiedOwnerId?: string;
  metricVisibilityRules?: MetricVisibilityRule[];
  publicMetricAnonymization?: true;
  submissionControls?: {
    globalLockout: boolean;
    lockoutReason: string;
    updatedAt: number;
    updatedBy: string;
  };
}
```

`MetricVisibilityRule` filters by `metricId`, `gameYear`, `eventKey`, `teamNumber`, and `matchLevel`. Public metric exports must pass records through `sanitizePublicMetricRecord`, which strips scout/member identity keys such as `scoutId`, `scoutName`, `submittedBy`, `userEmail`, and `displayName`.

## Form Builder Schemas

Team presets are stored in `formPresets`:

```ts
{
  teamId: string;
  name: string;
  formType: "match" | "pit";
  game: "REEFSCAPE" | "REBUILT";
  fields: Array<{
    id: string;
    label: string;
    type: "number" | "checkbox" | "text" | "select" | "rating" | "slider";
    section: string;
    options?: string[];
    scaleLabels?: string[];
    required: boolean;
  }>;
}
```

The objective bank in `app/utils/formObjectiveLibrary.ts` seeds Auto, Teleop, Endgame, Pit, Subjective, and Custom metrics from Charged Up, REEFSCAPE, REBUILT, and universal custom field types.

## Verification Math

`compareScoutToLead` checks a junior entry against a lead entry using metric tolerances:

- Auto fuel: within 2
- Teleop fuel: within 4
- Endgame fuel: within 2
- Auto climb: exact
- Endgame status: exact normalized level

Accuracy is `matchedMetrics / totalMetrics`. Entries at or above `85%` are marked `Verified`; otherwise they remain in review. The helper also supports feeding the result into the existing Bayesian scout accuracy model.

## Tactical Prediction

`buildTacticalPrediction` reads historical scouting entries for a team and filters by source:

- `official`: event scouting only
- `practice`: practice scouting only
- `combined`: both sources

The confidence tier (`75`, `85`, or `90`) selects the corresponding score percentile and blends it with the average to produce a conservative point estimate. Role is inferred from point output and climb tendency, then surfaced as editable pre-fill data in the match strategy form.

## Submission Lockout

`teams/{teamId}.submissionControls.globalLockout` disables new submissions in match scout, lead scout, pit scout, strategy, drive reflection, and match strategy forms. Edit mode remains available so admins can correct existing data during read-only windows.
