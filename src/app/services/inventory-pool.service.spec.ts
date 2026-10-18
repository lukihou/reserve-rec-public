import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, of, throwError, TimeoutError } from 'rxjs';

import { InventoryPoolService } from './inventory-pool.service';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';
import { InventoryPool } from '../shared/models/inventory-pool.model';

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

  const pools: InventoryPool[] = [
    { isOpen: true, available: 3 },
    { isOpen: true, available: 0 },
    { isOpen: true, available: null },
    { isOpen: false, available: null },
    { isOpen: true, available: null, closureStatus: true }
  ];

  for (const wrapped of [true, false]) {
    for (const pool of pools) {
      it(`returns ${JSON.stringify(pool)} from a ${wrapped ? 'wrapped' : 'raw'} response`, async () => {
        apiService.get.and.returnValue(of(wrapped ? { data: pool } : pool));

        expect(await fetchPool()).toEqual(pool);
        expect(apiService.get).toHaveBeenCalledOnceWith('inventoryPools/c1/dayuse/a1/p1', { date });
      });
    }
  }

  for (const status of [401, 403, 500, 0]) {
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
    expect(loggerService.error).toHaveBeenCalled();
  });

  it('returns null when the observable completes without a response', async () => {
    apiService.get.and.returnValue(EMPTY);

    expect(await fetchPool()).toBeNull();
    expect(loggerService.error).toHaveBeenCalled();
  });

  it('returns null when the request times out', async () => {
    const error = new TimeoutError();
    apiService.get.and.returnValue(throwError(() => error));

    expect(await fetchPool()).toBeNull();
    expect(loggerService.error).toHaveBeenCalledWith(error);
  });

  for (const [label, response] of [
    ['an empty body', null],
    ['an empty object', {}],
    ['a null envelope', { data: null }],
    ['an empty envelope', { data: undefined, isOpen: true, available: 3 }],
    ['a malformed raw count', { isOpen: true, available: '3' }],
    ['a malformed wrapped count', { data: { isOpen: true, available: Infinity } }]
  ] as const) {
    it(`returns null for ${label}`, async () => {
      apiService.get.and.returnValue(of(response));

      expect(await fetchPool()).toBeNull();
    });
  }

  it('can return successful inventory after a failed lookup', async () => {
    const pool = { isOpen: true, available: 3 };
    apiService.get.and.returnValues(throwError(() => new Error('Unavailable')), of({ data: pool }));

    expect(await fetchPool()).toBeNull();
    expect(await fetchPool()).toEqual(pool);
  });
});
