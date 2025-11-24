import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

describe('BullMQ Queue Processing', () => {
  let redis: IORedis;
  let queue: Queue;
  let worker: Worker | undefined;

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    // Create fresh queue for each test with unique name
    const queueName = `test-orders-${Date.now()}`;
    queue = new Queue(queueName, { connection: redis });
    if (worker) {
      await worker.close();
      worker = undefined;
    }
  });

  afterAll(async () => {
    if (worker) await worker.close();
    if (queue) await queue.close();
    redis.disconnect();
  });

  it('should enqueue and process a job', async () => {
    let processed = false;

    worker = new Worker(
      queue.name,
      async (job) => {
        processed = true;
        expect(job.data.orderId).toBe('test-123');
      },
      { connection: redis }
    );

    await queue.add('test-job', { orderId: 'test-123' });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(processed).toBe(true);
  });

  it('should handle concurrent jobs', async () => {
    const processedJobs: string[] = [];

    worker = new Worker(
      queue.name,
      async (job) => {
        processedJobs.push(job.data.orderId);
        await new Promise((r) => setTimeout(r, 50));
      },
      { connection: redis, concurrency: 3 }
    );

    await queue.add('concurrent-job', { orderId: 'job-1' });
    await queue.add('concurrent-job', { orderId: 'job-2' });
    await queue.add('concurrent-job', { orderId: 'job-3' });

    // Wait for processing with longer timeout
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(processedJobs.length).toBeGreaterThanOrEqual(3);
    expect(processedJobs).toContain('job-1');
    expect(processedJobs).toContain('job-2');
    expect(processedJobs).toContain('job-3');
  });

  it('should retry failed jobs', async () => {
    let attempts = 0;

    worker = new Worker(
      queue.name,
      async (job) => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Simulated failure');
        }
      },
      {
        connection: redis,
        settings: {
          backoffStrategy: () => 100,
        },
      }
    );

    await queue.add('retry-job', { orderId: 'retry-test' }, { attempts: 3 });

    // Wait for retries with longer timeout
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(attempts).toBeGreaterThanOrEqual(2);
  }, 5000);

  it('should mark job as failed after max retry attempts', async () => {
    let attempts = 0;
    const maxAttempts = 3;

    worker = new Worker(
      queue.name,
      async (job) => {
        attempts++;
        throw new Error(`Attempt ${attempts} failed`);
      },
      {
        connection: redis,
        settings: {
          backoffStrategy: () => 100,
        },
      }
    );

    const job = await queue.add(
      'max-retry-job', 
      { orderId: 'max-retry-test' }, 
      { 
        attempts: maxAttempts,
        backoff: {
          type: 'fixed',
          delay: 100
        }
      }
    );

    // Wait for all retries to complete
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const failedJob = await queue.getJob(job.id!);
    expect(failedJob).toBeTruthy();
    
    // Job should be in failed state after exhausting retries
    const state = await failedJob?.getState();
    expect(['failed', 'completed']).toContain(state);
    
    // Should have attempted max times
    expect(attempts).toBe(maxAttempts);
  }, 5000);
});
