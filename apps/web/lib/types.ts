import type { AgentConfig } from '@airtalk/engine'
import type { BusinessProfile, TemplateKey } from '@airtalk/engine/templates'

/**
 * What we persist in agents.config and every agent_config_versions row.
 * Keeping the profile (not just the generated AgentConfig) is what makes
 * "edit the FAQs" and rollback restore the wizard form, not just the prompt.
 */
export interface StoredAgentConfig {
  template: TemplateKey
  profile: BusinessProfile
  agentConfig: AgentConfig
}
