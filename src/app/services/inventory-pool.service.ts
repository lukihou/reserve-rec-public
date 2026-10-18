import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';
import { InventoryPool, parseInventoryPool } from '../shared/models/inventory-pool.model';

@Injectable({
  providedIn: 'root',
})
export class InventoryPoolService {
  constructor(
    private apiService: ApiService,
    private loggerService: LoggerService,
  ) { }

  /**
   * Fetch inventory pool data for a specific product on a given date.
   * Returns inventory data, or null when the lookup fails or is malformed.
   */
  async getInventoryPool(collectionId: string, activityType: string, activityId: string, productId: string, date: string): Promise<InventoryPool | null> {
    try {
      const result: unknown = await lastValueFrom(this.apiService.get(
        `inventoryPools/${collectionId}/${activityType}/${activityId}/${productId}`,
        { date }
      ));
      const pool = result && typeof result === 'object' && 'data' in result
        ? result.data
        : result;
      return parseInventoryPool(pool);
    } catch (error) {
      this.loggerService.error(`Failed to fetch inventory pool for date ${date}:`);
      this.loggerService.error(error);
      return null;
    }
  }
}
