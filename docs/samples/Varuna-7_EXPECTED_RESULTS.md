# Varuna-7 test proposal: expected compliance results

`Varuna-7_Offshore_Drilling_Proposal.pdf` is a fictional 3-page proposal with seven planted
violations of the indexed law and three compliant sections (controls). Upload it on the
Regulations page. Verified on 2026-10-03 with `openai/gpt-oss-120b`: 3 of 3 runs returned exactly
these 7 findings, all HIGH, every quote verified.

| # | Proposal section | Planted violation | Law passage the finding should cite |
|---|---|---|---|
| 1 | 4. Approvals (para 1) | No Central Government authorization (MoPNG, MoD, DG Shipping) for a rig in the EEZ | India_Offshore_Maritime_Laws.txt, §1 (EEZ Act 1976, s.7(5)) |
| 2 | 4. Approvals (para 2) | Drilling before prior MoEFCC Environmental Clearance | India_Offshore_Maritime_Laws.txt, §2 (EIA Notification 2006) |
| 3 | 5. Petroleum Lease | Operating before a petroleum lease is granted | source.pdf p.5 (ORD Act s.4A) |
| 4 | 6. Produced Water | Untreated produced water discharged to sea | India_Offshore_Maritime_Laws.txt, §3 (Water Act / CPCB) |
| 5 | 7. Drilling Fluids | Untreated drilling fluids and cuttings discharged overboard | India_Offshore_Maritime_Laws.txt, §3 (Water Act / CPCB) |
| 6 | 9. Crude Offtake | 100% of crude exported | source.pdf p.12 (domestic-sale policy) |
| 7 | 10. Decommissioning | Platform left in place, no abandonment plan or Site Restoration Fund | source.pdf p.12 (Site Restoration guidelines) |

Sections that should **not** be flagged: 2. Company and Ownership (Indian company, no
land-border investor), 3. Site Location (outside CRZ/ESZ), 8. Health, Safety and Security
(Offshore Safety Rules 2008, OISD, Coast Guard). A finding on any of these is a false positive.

To regenerate the PDF after editing the HTML:
`chromium --headless --no-pdf-header-footer --print-to-pdf=docs/samples/Varuna-7_Offshore_Drilling_Proposal.pdf docs/samples/Varuna-7_Offshore_Drilling_Proposal.html`
