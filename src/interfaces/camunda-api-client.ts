/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ICamundaApiClient {
  get(url: string, config?: any): Promise<{ data: any }>;
  post(url: string, data?: any, config?: any): Promise<{ data: any }>;
  put(url: string, data?: any, config?: any): Promise<{ data: any }>;
  delete(url: string, config?: any): Promise<{ data: any }>;
}
