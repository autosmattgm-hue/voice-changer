import { FirestoreRepository } from "../repositories/firestoreRepository.js";
import { env } from "../config/env.js";
import { getPlan } from "../config/plans.js";
import { GooglePlacesService } from "./googlePlacesService.js";
import { WebsiteAuditService } from "./websiteAuditService.js";
import { AppError } from "../utils/errors.js";
import { isAdminUser } from "../utils/entitlements.js";
import { enhanceSearchResult } from "./smartsearch.js";

const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 80;

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
    return true;
  }));
}

export class LeadService {
  constructor() {
    this.googlePlaces = new GooglePlacesService();
    this.websiteAudit = new WebsiteAuditService();
    this.leads = new FirestoreRepository("leads");
    this.auditLogs = new FirestoreRepository("auditLogs");
  }

  async currentAccessUser(user) {
    if (!user?.uid || isAdminUser(user)) return user;
    const stored = await this.leads.findById(user.uid);
    return { ...user, ...(stored || {}) };
  }

  async assertTrialAccess(user) {
    if (!isAdminUser(user)) {
      const usage = { used: 0, searchLimit: 10, leadLimit: 50, remaining: 10 };
      return usage;
    }
    return null;
  }

  async recordTrialSearch(user, usage) {
    if (!usage || !user?.uid) return null;
    return { ...usage, used: usage.used + 1 };
  }

  async search(search, user) {
    const accessUser = await this.currentAccessUser(user);
    const startingTrialUsage = await this.assertTrialAccess(accessUser);
    const admin = isAdminUser(accessUser) || accessUser?.entitlements?.unlimitedAccess || accessUser?.permissions?.includes?.("unlimited");
    const effectiveSearch = search;
    const bypassCache = Boolean(effectiveSearch?.bypassCache || effectiveSearch?.refreshSeed);
    const providerSearch = {
      ...effectiveSearch,
      limit: admin ? 500 : 100
    };
    const resultLimit = admin ? 500 : effectiveSearch?.limit || 50;
    const cacheKey = `${JSON.stringify(providerSearch)}-${admin ? "admin" : "user"}`;
    const cached = bypassCache ? null : searchCache.get(cacheKey);
    if (cached) {
      const updatedTrialUsage = await this.recordTrialSearch(accessUser, startingTrialUsage);
      await this.auditLogs.create({
        actor: accessUser?.email || "guest",
        action: "lead_search_cached",
        query: effectiveSearch,
        count: cached.leads?.length || 0
      });
      return {
        ...cached,
        leads: cached.leads,
        trial: updatedTrialUsage ? {
          ...updatedTrialUsage,
          limited: true,
          upgradeUrl: "/pricing.html"
        } : cached.trial
      };
    }

    const filtersRelaxed = filteredPool.length === 0 && audited.length > 0;
    const qualifiedPool = await this.fallbackLeadOrder(filtersRelaxed ? await this.fallbackLeadPool(audited) : filteredPool, effectiveSearch?.refreshSeed || "");

    const qualified = qualifiedPool.slice(0, resultLimit);

    await Promise.all(qualified.map((lead) => this.leads.upsert(lead.id, {
      ...lead,
      source: lead.source || "enhanced_search",
      discoveredBy: accessUser?.uid,
      discoveredAt: new Date().toISOString()
    })));

    const updatedTrialUsage = await this.recordTrialSearch(accessUser, startingTrialUsage);

    await this.auditLogs.create({
      actor: accessUser?.email || "guest",
      action: "lead_search",
      query: effectiveSearch,
      count: qualified.length
    });

    const response = {
      ...result,
      leads: qualified,
      cached: false,
      refreshed: bypassCache,
      refreshSeed: effectiveSearch?.refreshSeed || "",
      adminUnlimited: admin,
      searchStats: {
        requestedLimit: effectiveSearch?.limit || 50,
        returnedLimit: qualified.length,
        providerCandidateLimit: providerSearch.limit,
        rawCount: result.leads?.length || 0,
        auditedCount: audited.length,
        qualifiedCount: qualified.length,
        qualifiedPoolCount: qualifiedPool.length,
        filtersRelaxed,
        bypassCache,
        searchDepth: effectiveSearch?.searchDepth,
        leadQuality: "enhanced",
        sortBy: effectiveSearch?.sortBy
      },
      trial: updatedTrialUsage ? {
        ...updatedTrialUsage,
        limited: updatedTrialUsage.remaining <= 0,
        upgradeUrl: "/pricing.html"
      } : undefined
    };

    if (!bypassCache) searchCache.set(cacheKey, response);
    return response;
  }

  async fallbackLeadPool(audited) {
    return audited.slice(0, 100);
  }

  async save(leadId, user, fallbackLead = null) {
    let existing = null;
    try { existing = await this.getById(leadId); } catch { existing = null; }
    const lead = existing || fallbackLead;
    if (!lead) return null;
    return this.leads.upsert(lead.id, {
      ...lead,
      ownerId: user?.uid,
      stage: lead.stage || "New",
      savedAt: new Date().toISOString()
    });
  }

  async getById(id) {
    return await this.leads.findById(id) || null;
  }

  async getReport(id) {
    const lead = await this.getById(id);
    if (!lead) return null;
    const audit = lead.audit?.publicProfile ? lead.audit : await this.websiteAudit.audit(lead);
    const publicEnrichedLead = { ...lead };
    const enrichedLead = { ...publicEnrichedLead, audit, opportunityScore: audit.score, opportunityCategory: audit.category };
    return {
      lead: enrichedLead,
      dossier: { needs: [], bestOffer: "Contact info and website presence detected" },
      aiSummary: "Enhanced lead extraction ready"
    };
  }
}

function freshLeadOrder(leads, refreshSeed) {
  return leads.sort((a, b) => {
    const scoreA = Number(a.opportunityScore || 0) || 0;
    const scoreB = Number(b.opportunityScore || 0) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}