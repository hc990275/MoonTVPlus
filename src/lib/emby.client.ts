/* eslint-disable @typescript-eslint/no-explicit-any */

interface EmbyConfig {
  ServerURL: string;
  ApiKey?: string;
  Username?: string;
  Password?: string;
  UserId?: string;
  AuthToken?: string;
  // 高级流媒体选项
  removeEmbyPrefix?: boolean;
  appendMediaSourceId?: boolean;
  transcodeMp4?: boolean;
}

interface EmbyItem {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Season' | 'Episode';
  Overview?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  PremiereDate?: string;
  ImageTags?: { Primary?: string };
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaSources?: Array<{
    Id: string;
    MediaStreams?: Array<{
      Type: string;
      Index: number;
      DisplayTitle?: string;
      Language?: string;
      Codec?: string;
      IsExternal?: boolean;
      DeliveryUrl?: string;
    }>;
  }>;
}

interface EmbyItemsResult {
  Items: EmbyItem[];
  TotalRecordCount: number;
}

interface GetItemsParams {
  ParentId?: string;
  IncludeItemTypes?: string;
  Recursive?: boolean;
  Fields?: string;
  SortBy?: string;
  SortOrder?: string;
  StartIndex?: number;
  Limit?: number;
  searchTerm?: string;
}

interface EmbyView {
  Id: string;
  Name: string;
  CollectionType?: string;
}

export class EmbyClient {
  private serverUrl: string;
  private apiKey?: string;
  private userId?: string;
  private authToken?: string;
  private username?: string;
  private password?: string;
  private removeEmbyPrefix: boolean;
  private appendMediaSourceId: boolean;
  private transcodeMp4: boolean;

  constructor(config: EmbyConfig) {
    let serverUrl = config.ServerURL.replace(/\/$/, '');

    // 存储高级选项
    this.removeEmbyPrefix = config.removeEmbyPrefix || false;
    this.appendMediaSourceId = config.appendMediaSourceId || false;
    this.transcodeMp4 = config.transcodeMp4 || false;

    // 如果 URL 不包含 /emby 路径，自动添加（除非启用了 removeEmbyPrefix）
    if (!serverUrl.endsWith('/emby') && !this.removeEmbyPrefix) {
      serverUrl += '/emby';
    }

    // 如果启用了 removeEmbyPrefix 且 URL 包含 /emby，移除它
    if (this.removeEmbyPrefix && serverUrl.endsWith('/emby')) {
      serverUrl = serverUrl.slice(0, -5); // Remove '/emby'
    }

    this.serverUrl = serverUrl;
    this.apiKey = config.ApiKey;
    this.userId = config.UserId;
    this.authToken = config.AuthToken;
    this.username = config.Username;
    this.password = config.Password;

    console.log('[EmbyClient] constructor - ServerURL:', this.serverUrl);
    console.log('[EmbyClient] constructor - ApiKey:', this.apiKey);
    console.log('[EmbyClient] constructor - UserId:', this.userId);
    console.log('[EmbyClient] constructor - AuthToken:', this.authToken);
    console.log('[EmbyClient] constructor - Advanced Options:', {
      removeEmbyPrefix: this.removeEmbyPrefix,
      appendMediaSourceId: this.appendMediaSourceId,
      transcodeMp4: this.transcodeMp4,
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    // 如果有 ApiKey，不需要认证
    if (this.apiKey) return;

    // 如果有 AuthToken，假设它是有效的
    if (this.authToken) return;

    // 如果有用户名和密码，自动认证
    if (this.username && this.password) {
      console.log('[EmbyClient] Auto-authenticating with username/password');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-Emby-Token'] = this.apiKey;
    } else if (this.authToken) {
      headers['X-Emby-Token'] = this.authToken;
    }

    return headers;
  }

  async authenticate(username: string, password: string): Promise<{ AccessToken: string; User: { Id: string } }> {
    const url = `${this.serverUrl}/Users/AuthenticateByName`;
    console.log('[EmbyClient] authenticate - URL:', url);

    const params = new URLSearchParams({
      Username: username,
      Pw: password,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Emby-Authorization': 'MediaBrowser Client="LunaTV", Device="Web", DeviceId="lunatv-web", Version="1.0.0"',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EmbyClient] authenticate - Error:', response.status, errorText);
      throw new Error(`Emby 认证失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    this.authToken = data.AccessToken;
    this.userId = data.User.Id;
    return data;
  }

  async getCurrentUser(): Promise<{ Id: string; Name: string }> {
    const url = `${this.serverUrl}/Users/Me`;
    const headers = this.getHeaders();

    console.log('[EmbyClient] getCurrentUser - URL:', url);
    console.log('[EmbyClient] getCurrentUser - Headers:', JSON.stringify(headers, null, 2));

    try {
      const response = await fetch(url, { headers });

      console.log('[EmbyClient] getCurrentUser - Status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[EmbyClient] getCurrentUser - Error Response:', errorText);
        throw new Error(`获取当前用户信息失败 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('[EmbyClient] getCurrentUser - Success:', data);
      return data;
    } catch (error) {
      console.error('[EmbyClient] getCurrentUser - Exception:', error);
      throw error;
    }
  }

  async getUserViews(): Promise<EmbyView[]> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID，请在管理面板重新保存 Emby 配置');
    }

    const token = this.apiKey || this.authToken;
    const url = `${this.serverUrl}/Users/${this.userId}/Views${token ? `?api_key=${token}` : ''}`;

    console.log('[EmbyClient] getUserViews - URL:', url);

    const response = await fetch(url);

    // 如果是 401 错误且有用户名密码，尝试重新认证
    if (response.status === 401 && this.username && this.password && !this.apiKey) {
      console.log('[EmbyClient] Token expired, re-authenticating...');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;

      // 重试请求
      const retryUrl = `${this.serverUrl}/Users/${this.userId}/Views?api_key=${this.authToken}`;
      const retryResponse = await fetch(retryUrl);

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        throw new Error(`获取 Emby 媒体库列表失败 (${retryResponse.status}): ${errorText}`);
      }

      const retryData = await retryResponse.json();
      return retryData.Items || [];
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取 Emby 媒体库列表失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.Items || [];
  }

  async getItems(params: GetItemsParams): Promise<EmbyItemsResult> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID，请在管理面板重新保存 Emby 配置');
    }

    const searchParams = new URLSearchParams();

    if (params.ParentId) searchParams.set('ParentId', params.ParentId);
    if (params.IncludeItemTypes) searchParams.set('IncludeItemTypes', params.IncludeItemTypes);
    if (params.Recursive !== undefined) searchParams.set('Recursive', params.Recursive.toString());
    if (params.Fields) searchParams.set('Fields', params.Fields);
    if (params.SortBy) searchParams.set('SortBy', params.SortBy);
    if (params.SortOrder) searchParams.set('SortOrder', params.SortOrder);
    if (params.StartIndex !== undefined) searchParams.set('StartIndex', params.StartIndex.toString());
    if (params.Limit !== undefined) searchParams.set('Limit', params.Limit.toString());
    if (params.searchTerm) searchParams.set('searchTerm', params.searchTerm);

    // 添加认证参数
    const token = this.apiKey || this.authToken;
    if (token) {
      searchParams.set('X-Emby-Token', token);
    }

    const url = `${this.serverUrl}/Users/${this.userId}/Items?${searchParams.toString()}`;

    console.log('[EmbyClient] getItems - URL:', url);
    console.log('[EmbyClient] getItems - Token:', token);
    console.log('[EmbyClient] getItems - UserId:', this.userId);

    const response = await fetch(url);

    // 如果是 401 错误且有用户名密码，尝试重新认证
    if (response.status === 401 && this.username && this.password && !this.apiKey) {
      console.log('[EmbyClient] Token expired, re-authenticating...');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;

      // 重试请求
      searchParams.set('X-Emby-Token', this.authToken);
      const retryUrl = `${this.serverUrl}/Users/${this.userId}/Items?${searchParams.toString()}`;
      const retryResponse = await fetch(retryUrl);

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        throw new Error(`获取 Emby 媒体列表失败 (${retryResponse.status}): ${errorText}`);
      }

      return await retryResponse.json();
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取 Emby 媒体列表失败 (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  async getItem(itemId: string): Promise<EmbyItem> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID，请在管理面板重新保存 Emby 配置');
    }

    const token = this.apiKey || this.authToken;
    const url = `${this.serverUrl}/Users/${this.userId}/Items/${itemId}?Fields=MediaSources${token ? `&api_key=${token}` : ''}`;
    const response = await fetch(url);

    // 如果是 401 错误且有用户名密码，尝试重新认证
    if (response.status === 401 && this.username && this.password && !this.apiKey) {
      console.log('[EmbyClient] Token expired, re-authenticating...');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;

      // 重试请求
      const retryToken = this.authToken;
      const retryUrl = `${this.serverUrl}/Users/${this.userId}/Items/${itemId}?Fields=MediaSources${retryToken ? `&api_key=${retryToken}` : ''}`;
      const retryResponse = await fetch(retryUrl);

      if (!retryResponse.ok) {
        throw new Error('获取 Emby 媒体详情失败');
      }

      return await retryResponse.json();
    }

    if (!response.ok) {
      throw new Error('获取 Emby 媒体详情失败');
    }

    return await response.json();
  }

  async getSeasons(seriesId: string): Promise<EmbyItem[]> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID，请在管理面板重新保存 Emby 配置');
    }

    const token = this.apiKey || this.authToken;
    const url = `${this.serverUrl}/Shows/${seriesId}/Seasons?userId=${this.userId}${token ? `&api_key=${token}` : ''}`;
    const response = await fetch(url);

    // 如果是 401 错误且有用户名密码，尝试重新认证
    if (response.status === 401 && this.username && this.password && !this.apiKey) {
      console.log('[EmbyClient] Token expired, re-authenticating...');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;

      // 重试请求
      const retryToken = this.authToken;
      const retryUrl = `${this.serverUrl}/Shows/${seriesId}/Seasons?userId=${this.userId}${retryToken ? `&api_key=${retryToken}` : ''}`;
      const retryResponse = await fetch(retryUrl);

      if (!retryResponse.ok) {
        throw new Error('获取 Emby 季列表失败');
      }

      const retryData = await retryResponse.json();
      return retryData.Items || [];
    }

    if (!response.ok) {
      throw new Error('获取 Emby 季列表失败');
    }

    const data = await response.json();
    return data.Items || [];
  }

  async getEpisodes(seriesId: string, seasonId?: string): Promise<EmbyItem[]> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID，请在管理面板重新保存 Emby 配置');
    }

    const token = this.apiKey || this.authToken;
    const searchParams = new URLSearchParams({
      userId: this.userId!,
      Fields: 'MediaSources',
    });

    if (seasonId) {
      searchParams.set('seasonId', seasonId);
    }

    if (token) {
      searchParams.set('api_key', token);
    }

    const url = `${this.serverUrl}/Shows/${seriesId}/Episodes?${searchParams.toString()}`;
    const response = await fetch(url);

    // 如果是 401 错误且有用户名密码，尝试重新认证
    if (response.status === 401 && this.username && this.password && !this.apiKey) {
      console.log('[EmbyClient] Token expired, re-authenticating...');
      const authResult = await this.authenticate(this.username, this.password);
      this.authToken = authResult.AccessToken;
      this.userId = authResult.User.Id;

      // 重试请求
      const retrySearchParams = new URLSearchParams({
        userId: this.userId!,
        Fields: 'MediaSources',
      });

      if (seasonId) {
        retrySearchParams.set('seasonId', seasonId);
      }

      if (this.authToken) {
        retrySearchParams.set('api_key', this.authToken);
      }

      const retryUrl = `${this.serverUrl}/Shows/${seriesId}/Episodes?${retrySearchParams.toString()}`;
      const retryResponse = await fetch(retryUrl);

      if (!retryResponse.ok) {
        throw new Error('获取 Emby 集列表失败');
      }

      const retryData = await retryResponse.json();
      return retryData.Items || [];
    }

    if (!response.ok) {
      throw new Error('获取 Emby 集列表失败');
    }

    const data = await response.json();
    return data.Items || [];
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      const token = this.apiKey || this.authToken;
      const url = `${this.serverUrl}/System/Info/Public${token ? `?api_key=${token}` : ''}`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  getImageUrl(itemId: string, imageType: 'Primary' | 'Backdrop' | 'Logo' = 'Primary', maxWidth?: number): string {
    const params = new URLSearchParams();
    const token = this.apiKey || this.authToken;

    if (maxWidth) params.set('maxWidth', maxWidth.toString());
    if (token) params.set('api_key', token);

    const queryString = params.toString();
    return `${this.serverUrl}/Items/${itemId}/Images/${imageType}${queryString ? '?' + queryString : ''}`;
  }

  /**
   * 获取 PlaybackInfo 以获取 MediaSourceId
   */
  async getPlaybackInfo(itemId: string): Promise<{ MediaSourceId?: string }> {
    await this.ensureAuthenticated();

    if (!this.userId) {
      throw new Error('未配置 Emby 用户 ID');
    }

    const token = this.apiKey || this.authToken;
    const url = `${this.serverUrl}/Items/${itemId}/PlaybackInfo?UserId=${this.userId}${token ? `&api_key=${token}` : ''}`;

    console.log('[EmbyClient] getPlaybackInfo - URL:', url);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          DeviceProfile: {
            MaxStreamingBitrate: 120000000,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: 384000,
          },
        }),
      });

      if (!response.ok) {
        console.error('[EmbyClient] getPlaybackInfo failed:', response.status);
        return {};
      }

      const data = await response.json();
      const mediaSourceId = data.MediaSources?.[0]?.Id;

      console.log('[EmbyClient] getPlaybackInfo - MediaSourceId:', mediaSourceId);

      return { MediaSourceId: mediaSourceId };
    } catch (error) {
      console.error('[EmbyClient] getPlaybackInfo error:', error);
      return {};
    }
  }

  async getStreamUrl(itemId: string, direct: boolean = true): Promise<string> {
    const token = this.apiKey || this.authToken;
    let url: string;

    console.log('[EmbyClient] getStreamUrl - itemId:', itemId, 'direct:', direct);
    console.log('[EmbyClient] getStreamUrl - Options:', {
      appendMediaSourceId: this.appendMediaSourceId,
      transcodeMp4: this.transcodeMp4,
    });

    if (direct) {
      // 选项3: 转码mp4
      if (this.transcodeMp4) {
        url = `${this.serverUrl}/Videos/${itemId}/stream.mp4?api_key=${token}`;
      } else {
        url = `${this.serverUrl}/Videos/${itemId}/stream?Static=true&api_key=${token}`;
      }

      // 选项2: 拼接MediaSourceId参数
      if (this.appendMediaSourceId) {
        console.log('[EmbyClient] getStreamUrl - Attempting to get MediaSourceId...');
        try {
          const playbackInfo = await this.getPlaybackInfo(itemId);
          if (playbackInfo.MediaSourceId) {
            url += `&MediaSourceId=${playbackInfo.MediaSourceId}`;
            console.log('[EmbyClient] getStreamUrl - MediaSourceId appended:', playbackInfo.MediaSourceId);
          } else {
            console.log('[EmbyClient] getStreamUrl - No MediaSourceId returned from PlaybackInfo');
          }
        } catch (error) {
          console.error('[EmbyClient] Failed to get MediaSourceId:', error);
          // 继续使用不带 MediaSourceId 的 URL
        }
      }
    } else {
      url = `${this.serverUrl}/Videos/${itemId}/master.m3u8?api_key=${token}`;
    }

    console.log('[EmbyClient] getStreamUrl - Final URL:', url);
    return url;
  }

  getSubtitles(item: EmbyItem): Array<{ url: string; language: string; label: string }> {
    const subtitles: Array<{ url: string; language: string; label: string }> = [];

    if (!item.MediaSources || item.MediaSources.length === 0) {
      return subtitles;
    }

    const mediaSource = item.MediaSources[0];
    if (!mediaSource.MediaStreams) {
      return subtitles;
    }

    const token = this.apiKey || this.authToken;

    mediaSource.MediaStreams
      .filter((stream) => stream.Type === 'Subtitle')
      .forEach((stream) => {
        const language = stream.Language || 'unknown';
        const label = stream.DisplayTitle || `${language} (${stream.Codec})`;

        // 外部字幕使用 DeliveryUrl
        if (stream.IsExternal && stream.DeliveryUrl) {
          subtitles.push({
            url: `${this.serverUrl}${stream.DeliveryUrl}`,
            language,
            label,
          });
        } else {
          // 内嵌字幕使用 Stream API
          subtitles.push({
            url: `${this.serverUrl}/Videos/${item.Id}/${mediaSource.Id}/Subtitles/${stream.Index}/Stream.vtt?api_key=${token}`,
            language,
            label,
          });
        }
      });

    return subtitles;
  }
}
