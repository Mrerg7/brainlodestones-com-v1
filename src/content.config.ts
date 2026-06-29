import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const useCases = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/use-cases' }),
  schema: z.object({
    title: z.string(),
    tag: z.string(),
    description: z.string(),
    order: z.number(),
  }),
});

export const collections = { useCases };
