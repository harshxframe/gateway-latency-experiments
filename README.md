# LLM Gateway Latency Experiments

Experiments measuring API response latency, streaming behavior, and model inference performance using OpenRouter's free-tier models.

## 1. Complete Response Latency

| Model | Prompt Tokens | Completion Tokens | Total Latency |
|---|---:|---:|---:|
| `recursive/flint-v1.0:free` | 3 | 145 | 2,245 ms |
| `recursive/flint-v1.0:free` | 8 | 194 | 2,993 ms |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 22 | 50 | 2,812 ms |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 28 | 1,596 | 35,275 ms |
| `cohere/north-mini-code:free` | 12 | 714 | 3,759 ms |
| `cohere/north-mini-code:free` | 1 | 32 | 2,133 ms |

All requests reported a cost of $0.

### Observations

- Latency varied across models and prompts.
- A 1,596-token response took 35.275 seconds.
- Output length, reasoning, model performance, and provider load can influence response time.
- These results use different prompts and are not a controlled model comparison.

## 2. Streaming Latency

**Model:** `poolside/laguna-xs-2.1:free`

| Metric | Result |
|---|---:|
| Time to first byte | 441 ms |
| First reasoning token | 441 ms |
| First answer token | 5,478 ms |
| Total response time | 5,827 ms |
| Reported generation speed | 24.37 tokens/s |
| Prompt tokens | 46 |
| Completion tokens | 142 |
| Reasoning tokens | 127 |
| Cost | $0 |

### Observations

- Initial response data arrived in 441 ms.
- The first answer token arrived after 5.478 seconds.
- The complete response took 5.827 seconds.
- The approximately 5-second gap between the first byte and first answer token highlights the impact of model reasoning before visible output.

## 3. Latency Components

The experiments distinguish three important measurements:

| Metric | What It Measures |
|---|---|
| Time to first byte (TTFB) | Time until the first response data arrives |
| Time to first answer token (TTFT) | Time until user-facing answer text begins |
| Total latency | Time until the complete response is received |

A fast first byte does not necessarily mean a fast user-facing answer.

## 4. Gateway Performance Objective

The target is to keep additional gateway overhead within **50–60 ms**, while continuing to investigate opportunities for further optimization.

Potential contributors to gateway overhead include:

- Request processing and authentication
- Network communication
- HTTP connection management
- Streaming response forwarding
- Buffering and serialization

Gateway overhead must be measured separately from upstream model inference latency.

## 5. Next Experiments

- Repeat streaming tests to measure P50, P95, and P99 latency.
- Compare multiple models using identical prompts.
- Measure time to first answer token and total completion time.
- Compare streaming and non-streaming requests under equivalent conditions.
- Measure gateway processing overhead independently.
- Investigate persistent connections and streaming passthrough.
- Compare free-tier and paid models under controlled workloads.

*All results reflect the specific models, prompts, and test conditions used. Paid-model performance and the gateway overhead target have not yet been independently benchmarked.*
