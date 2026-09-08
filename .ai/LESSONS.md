# LESSONS.md — qui PORTE chaque leçon durable

> **Généré** par `npm run lessons:carriers -- --write`. Ne pas éditer à la main.
> Répond à une seule question : cette leçon agit-elle sur le PRODUIT (donc sur les
> applications générées), sur le DÉPÔT (donc sur le développement du framework),
> ou seulement sur l'agent qui la relit ?

| classe | leçons |
| --- | ---: |
| PRODUIT — du code livré la porte | 8 |
| DÉPÔT — un gate ou un script la porte | 30 |
| CONTEXTE — relue seulement | 77 |
| INERTE — rien ne la cite | 0 |

## PRODUIT

- **feedback_ci_nodefony** — src/nodefony/package.json
- **feedback_config_docs** — src/packages/@nodefony/http/nodefony/config/config.ts
- **feedback_config_validation_zod** — src/packages/@nodefony/security/nodefony/config/config.ts
- **feedback_prod_brick_not_in_dev_module** — src/nodefony/src/kernel/Kernel.ts · src/modules/test/nodefony/config/config.ts
- **feedback_recharts_react19** — src/packages/@nodefony/studio/frontend/src/routes/DashboardSupervision.tsx
- **feedback_service_options_delete** — src/nodefony/src/Service.ts
- **feedback_studio_realtime_stats_mobx** — src/nodefony/src/client/realtime/RealtimeClient.ts · src/nodefony/src/client/index.ts · src/nodefony
- **feedback_watch_rollup_pitfall** — src/nodefony/src/service/dev/DevSupervisor.ts

## DÉPÔT

- **feedback_bash_cwd_drift** — src/nodefony
- **feedback_caveman_lexique** — docs/lexique.md · src/packages/@nodefony/security/docs/lexique.md
- **feedback_cd_startsh_relative_path** — src/packages/@nodefony/http · .claude/skills/nodefony-start-server/start.sh
- **feedback_ci_is_free_dont_double_it** — npm run test:memory
- **feedback_coverage_modules** — npm run test · npm run test:load
- **feedback_cross_platform_axioms** — .claude/skills/nodefony-framework-dev/references/portabilite.md
- **feedback_doc_reader_first_situations** — src/packages/@nodefony/security/docs/firewall.md
- **feedback_doc_vulgarization** — docs/README.md
- **feedback_gate_must_bite** — src/packages/@nodefony/studio/frontend
- **feedback_git_index_lock** — scripts/safe-commit.sh
- **feedback_load_tests_separation** — npm run test:integration
- **feedback_module_docs_scaffold** — docs/index.md · .claude/skills/nodefony-create-module/references/templates.md
- **feedback_npm_tree_not_a_guarantee** — npm run build
- **feedback_perf_tests_optin** — src/nodefony/src/tests/Tools.test.ts
- **feedback_permission_autonomy** — .claude/settings.json
- **feedback_prove_the_target_not_the_verdict** — .claude/skills · scripts/env-snapshot.ts
- **feedback_refactor_grep_consumers** — src/modules/test
- **feedback_root_dist_stale_modules** — src/modules/test
- **feedback_server_kill_oneshot** — .claude/settings.local.json
- **feedback_server_startup** — src/modules/test
- **feedback_session_pitfalls** — npm run build · npm run clean · npm run test:integration
- **feedback_shell_false_diagnostics** — npm run build
- **feedback_stale_decor_poisons_verdicts** — src/modules/test
- **feedback_subagent_skills_must_be_named** — docs/outillage-agents.md
- **feedback_test_discriminant_or_dead** — npm run build
- **feedback_test_framework_vitest** — src/modules/mediasoup
- **feedback_test_module_controllers** — src/modules/test
- **feedback_test_strategy** — src/modules/test
- **feedback_turbo_cache_stale_logs** — src/modules/test
- **feedback_typed_events_conditional_pattern** — docs/session-retros/archive/2026-05-28-bf1f5dab.md

## CONTEXTE

- **feedback_agent_example_over_prose** — cité dans 2 artefact(s)
- **feedback_anchor_expires_silently** — cité dans 2 artefact(s)
- **feedback_announce_gaps_first** — cité dans 2 artefact(s)
- **feedback_audit_force_de_proposition** — cité dans 2 artefact(s)
- **feedback_bench_isolate_session_store** — cité dans 1 artefact(s)
- **feedback_bench_machine_regime** — cité dans 2 artefact(s)
- **feedback_bench_probe_false_verdicts** — cité dans 2 artefact(s)
- **feedback_board_days_are_not_calendar** — cité dans 3 artefact(s)
- **feedback_browser_loop_ask_console** — cité dans 1 artefact(s)
- **feedback_c8_incompatible_esm_node26** — cité dans 2 artefact(s)
- **feedback_capability_unreachable_is_absent** — cité dans 2 artefact(s)
- **feedback_code_rewrite_mechanical_traps** — cité dans 2 artefact(s)
- **feedback_commit_fr_apostrophes** — cité dans 2 artefact(s)
- **feedback_comprehension_pacing** — cité dans 2 artefact(s)
- **feedback_convention_frere** — cité dans 3 artefact(s)
- **feedback_css_perf** — cité dans 1 artefact(s)
- **feedback_debug_instrument_choke_point** — cité dans 2 artefact(s)
- **feedback_delegation_balance** — cité dans 2 artefact(s)
- **feedback_design_dialogue_prose** — cité dans 2 artefact(s)
- **feedback_design_doc_is_not_a_verified_scope** — cité dans 2 artefact(s)
- **feedback_destructive_needs_identity_scope** — cité dans 2 artefact(s)
- **feedback_dev_axes** — cité dans 2 artefact(s)
- **feedback_doc_dejournal** — cité dans 2 artefact(s)
- **feedback_doc_placement** — cité dans 4 artefact(s)
- **feedback_dogfood_distributed_templates** — cité dans 2 artefact(s)
- **feedback_edit_requires_read_tool** — cité dans 2 artefact(s)
- **feedback_env_var_nf_prefix** — cité dans 4 artefact(s)
- **feedback_error_message_names_all_causes** — cité dans 2 artefact(s)
- **feedback_fix_the_family_not_the_instance** — cité dans 2 artefact(s)
- **feedback_gate_must_run** — cité dans 5 artefact(s)
- **feedback_gitignored_breaks_clone** — cité dans 2 artefact(s)
- **feedback_green_covers_only_its_diff** — cité dans 2 artefact(s)
- **feedback_inventory_needs_crosscheck** — cité dans 2 artefact(s)
- **feedback_legacy_no_backcompat** — cité dans 2 artefact(s)
- **feedback_live_cluster_debug_workflow** — cité dans 1 artefact(s)
- **feedback_measure_method** — cité dans 2 artefact(s)
- **feedback_migration_status_for_ai** — cité dans 1 artefact(s)
- **feedback_migration_status_uptodate** — cité dans 2 artefact(s)
- **feedback_module_docs** — cité dans 3 artefact(s)
- **feedback_named_process_titles** — cité dans 2 artefact(s)
- **feedback_no_commit_docs_without_validation** — cité dans 2 artefact(s)
- **feedback_no_headless_chrome** — cité dans 1 artefact(s)
- **feedback_nodefony_not_symfony_clone** — cité dans 1 artefact(s)
- **feedback_observability_no_prod_impact** — cité dans 2 artefact(s)
- **feedback_orm_bancs_vitest_migration** — cité dans 2 artefact(s)
- **feedback_orm_default_first** — cité dans 3 artefact(s)
- **feedback_parallel_subagents** — cité dans 2 artefact(s)
- **feedback_param_accepted_then_dropped** — cité dans 2 artefact(s)
- **feedback_perf_memory_rule** — cité dans 4 artefact(s)
- **feedback_prove_on_received_artifact** — cité dans 3 artefact(s)
- **feedback_redteam_threat_first** — cité dans 2 artefact(s)
- **feedback_repo_command_is_authority** — cité dans 2 artefact(s)
- **feedback_rg_no_replace_flag** — cité dans 2 artefact(s)
- **feedback_security_audit_surface_matrix** — cité dans 2 artefact(s)
- **feedback_security_rfc_rigor** — cité dans 7 artefact(s)
- **feedback_session_hygiene** — cité dans 2 artefact(s)
- **feedback_session_resume_workflow** — cité dans 1 artefact(s)
- **feedback_session_retros_purpose** — cité dans 2 artefact(s)
- **feedback_shell_no_unquoted_multipath** — cité dans 2 artefact(s)
- **feedback_single_source_rule** — cité dans 3 artefact(s)
- **feedback_skill_authoring** — cité dans 4 artefact(s)
- **feedback_source_over_memory** — cité dans 2 artefact(s)
- **feedback_spa_fallback_literal** — cité dans 2 artefact(s)
- **feedback_spec_conformance_vs_reachability** — cité dans 2 artefact(s)
- **feedback_sse_http2_request_close** — cité dans 6 artefact(s)
- **feedback_studio_ergonomie_progressive** — cité dans 2 artefact(s)
- **feedback_studio_layout_rigor** — cité dans 3 artefact(s)
- **feedback_subagent_model_in_label** — cité dans 3 artefact(s)
- **feedback_suspect_instrument_and_own_diff** — cité dans 2 artefact(s)
- **feedback_terminology_forage** — cité dans 1 artefact(s)
- **feedback_test_no_fixed_delay** — cité dans 2 artefact(s)
- **feedback_tests** — cité dans 2 artefact(s)
- **feedback_token_economy** — cité dans 3 artefact(s)
- **feedback_user_repeats_question** — cité dans 2 artefact(s)
- **feedback_user_visibility** — cité dans 2 artefact(s)
- **feedback_writing_tone_audience** — cité dans 2 artefact(s)
- **feedback_written_rule_needs_reread** — cité dans 1 artefact(s)

## INERTE

