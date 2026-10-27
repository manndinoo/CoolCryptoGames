# Grading policy v1: installed in the AI prompt (server/ai/policy.mjs) as of Linewatch 2.0

Owner's core rule: Critical is reserved for a supported serious danger to people, equipment or wildfire ignition requiring immediate attention. This is a proposed product policy requiring qualified utility review, not a universal regulatory standard. Utility procedures set response deadlines.

| Grade | Threshold | Response |
|---|---|---|
| Red / Critical | Supported serious public danger, major equipment failure or serious wildfire ignition hazard | Immediate utility review alert |
| Purple / High | Significant defect needing prompt assessment without sufficient evidence for Critical | Priority assessment/work ticket |
| Yellow / Monitor | Minor/developing defect without supported significant functional impairment | Maintenance/reinspection |
| Green / No visible concern | Adequate applicable visual coverage with no apparent defect | Routine schedule; never safety certification |
| Gray / Incomplete | Insufficient, missing, obstructed, blurred or contradictory evidence | Request specific evidence/field assessment; never automatic Green |

## Critical gate: explain all three
1. Specific hazardous condition on a named component, with photo IDs or explicitly attributed qualified field evidence.
2. Credible serious consequence to people, equipment or wildfire ignition and the mechanism.
3. Why immediate utility attention is warranted, not routine scheduling. Active failure need not already have occurred.

Required format: Photo [ID] shows [defect] on [component]. This creates a serious [public/equipment/wildfire] hazard because [mechanism]. Immediate utility assessment is warranted because [evidence].

Age, cosmetic rust, weathering, minor checking, looking bad or “could eventually fail” alone do not satisfy the gate. Suspected serious hazards receive an urgent human-review flag, not a routine retake queue. Lack of sparks does not establish a downed conductor is deenergized.

## Agent sequence
1. Verify structure ID, image date/source and current vs historical status. Phone GPS is camera position until confirmed as pole position.
2. Check usable coverage of applicable components and identify missing views.
3. Screen for serious hazards and urgent uncertainty.
4. Inspect each component; separate visible observation, suspicion and operator notes.
5. Explain defect consequences and unknowns.
6. Apply approved utility criteria; do not invent engineering limits.
7. Grade each finding with linked photos and follow-up.
8. Use highest supported urgency across all batches; report completeness separately.
9. Produce report and proposed ticket.
10. Record human review, reasons for grade changes and audit history. Unresolved Critical flags remain until explicitly resolved.

## Examples
Broken/displaced support, falling equipment, downed electrical conductor, flames, serious contact or supported ignition danger can qualify Critical. Broken arm/guy/attachment severity depends on actual support/contact consequences. Significant insulator or connector damage can be High; Critical needs serious-danger evidence. Apparent lean/tilt is not a reliable 3D measurement. Vegetation proximity alone does not prove contact or clearance violation. Old scorching, leakage, coating loss or staining require source/extent/current-condition assessment. Dry fuels/fire weather/prior regional fires are context, not proof of a pole defect.

## Rules
- Never average away a serious defect: one supported Critical finding controls the structure grade.
- Several minor defects do not become Critical without a documented combined serious hazard.
- Never invent voltage, energization, loads, internal decay, true lean, clearance or numeric defect thresholds.
- Keep evidence confidence and coverage separate from severity; missing views do not erase a visible hazard.
- Historical accidents do not become current mapped incidents at fabricated coordinates.
- Better-looking later photos or completed work tickets do not automatically clear unresolved hazards.
- Green never means safe to climb, touch or work.
- Follow-up means qualified utility assessment; no generated switching, approach or repair instructions.

Reference context discussed (not a substitute for company standards):
https://www.osha.gov/sites/default/files/publications/DOWNED_ELECTRICAL_WIRES.pdf
https://docs.cpuc.ca.gov/PUBLISHED/GENERAL_ORDER/159182.htm
