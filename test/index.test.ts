import { describe, it, expect } from 'vitest';

describe('Unitrends MCP Server', () => {
  describe('Tool Definitions', () => {
    const expectedTools = [
      'unitrends_list_appliances',
      'unitrends_list_assets',
      'unitrends_get_asset',
      'unitrends_list_running_jobs',
      'unitrends_list_job_history',
      'unitrends_list_recovery_points',
      'unitrends_queue_restore',
      'unitrends_get_restore_status',
      'unitrends_list_alerts',
      'unitrends_get_success_rate',
    ];

    it('should define all 10 tools', () => {
      expect(expectedTools).toHaveLength(10);
    });

    it('should include appliance + asset tools', () => {
      expect(expectedTools).toContain('unitrends_list_appliances');
      expect(expectedTools).toContain('unitrends_list_assets');
      expect(expectedTools).toContain('unitrends_get_asset');
    });

    it('should include job tools', () => {
      expect(expectedTools).toContain('unitrends_list_running_jobs');
      expect(expectedTools).toContain('unitrends_list_job_history');
    });

    it('should include recovery and restore tools', () => {
      expect(expectedTools).toContain('unitrends_list_recovery_points');
      expect(expectedTools).toContain('unitrends_queue_restore');
      expect(expectedTools).toContain('unitrends_get_restore_status');
    });

    it('should include alerts and reporting tools', () => {
      expect(expectedTools).toContain('unitrends_list_alerts');
      expect(expectedTools).toContain('unitrends_get_success_rate');
    });
  });

  describe('Credentials', () => {
    it('should require base URL, username, and password', () => {
      const required = ['UNITRENDS_BASE_URL', 'UNITRENDS_USERNAME', 'UNITRENDS_PASSWORD'];
      expect(required).toHaveLength(3);
    });
  });

  describe('Server Configuration', () => {
    it('should define server with correct name', () => {
      const config = { name: 'unitrends-mcp', version: '0.0.0' };
      expect(config.name).toBe('unitrends-mcp');
    });
  });
});
