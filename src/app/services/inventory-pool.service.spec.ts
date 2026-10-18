import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { InventoryPoolService } from './inventory-pool.service';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';

describe('InventoryPoolService', () => {
  let service: InventoryPoolService;
  let apiService: jasmine.SpyObj<ApiService>;
  let loggerService: jasmine.SpyObj<LoggerService>;
  const date = '2026-10-12';
  const fetchPool = () => service.getInventoryPool('c1', 'dayuse', 'a1', 'p1', date);

  beforeEach(() => {
    apiService = jasmine.createSpyObj('ApiService', ['get']);
    loggerService = jasmine.createSpyObj('LoggerService', ['error']);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: apiService },
        { provide: LoggerService, useValue: loggerService }
      ]
    });
    service = TestBed.inject(InventoryPoolService);
  });

  it('returns the inventory from a wrapped response', async () => {
    const pool = { isOpen: true, available: 0 };
    apiService.get.and.returnValue(of({ data: pool }));

    expect(await fetchPool()).toEqual(pool);
    expect(apiService.get).toHaveBeenCalledOnceWith('inventoryPools/c1/dayuse/a1/p1', { date });
  });

  it('preserves an unwrapped no-pass-required response', async () => {
    const pool = { isOpen: false, available: null };
    apiService.get.and.returnValue(of(pool));

    expect(await fetchPool()).toEqual(pool);
  });

  for (const status of [403, 500, 0]) {
    it(`returns null instead of inventory when the request fails with status ${status}`, async () => {
      const error = new HttpErrorResponse({ status });
      apiService.get.and.returnValue(throwError(() => error));

      expect(await fetchPool()).toBeNull();
      expect(loggerService.error).toHaveBeenCalledWith(error);
    });
  }

  it('returns null when the API throws synchronously while offline', async () => {
    apiService.get.and.throwError('Network Offline');

    expect(await fetchPool()).toBeNull();
  });

  it('can return successful inventory after a failed lookup', async () => {
    const pool = { isOpen: true, available: 3 };
    apiService.get.and.returnValues(throwError(() => new Error('Unavailable')), of({ data: pool }));

    expect(await fetchPool()).toBeNull();
    expect(await fetchPool()).toEqual(pool);
  });
});
