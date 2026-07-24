using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClassIsland.ExamReminder.Models;

namespace ClassIsland.ExamReminder.Services;

public sealed class ExamBoardClient : IDisposable
{
    private const int ApiVersion = 2;
    private const string ClientVersion = "0.2.0.0";
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(10),
    };

    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    public async Task<ClientResult<Uri>> StartPairingAsync(
        string baseUrl,
        string pluginInstanceId,
        string clientSecret,
        string pairToken,
        CancellationToken cancellationToken = default)
    {
        var result = await PostAsync<SimpleResponse>(baseUrl, new
        {
            action = "plugin-pair-start",
            pluginInstanceId,
            clientSecret,
            pairToken,
            apiVersion = ApiVersion,
            clientVersion = ClientVersion,
        }, cancellationToken);
        return result.IsSuccess && result.Value?.Ok == true
            ? ClientResult<Uri>.Success(ExamBoardUrls.Pairing(baseUrl, pairToken))
            : ClientResult<Uri>.Failure(result.Error ?? "考试看板拒绝了配对请求");
    }

    public Task<ClientResult<PairStatusResponse>> GetPairStatusAsync(
        PluginSettings settings,
        CancellationToken cancellationToken = default) =>
        PostAsync<PairStatusResponse>(settings.BaseUrl, new
        {
            action = "plugin-pair-status",
            pluginInstanceId = settings.PluginInstanceId,
            clientSecret = settings.ClientSecret,
            apiVersion = ApiVersion,
            clientVersion = ClientVersion,
        }, cancellationToken);

    public Task<ClientResult<ExamBoardBootstrapResponse>> GetBootstrapAsync(
        PluginSettings settings,
        CancellationToken cancellationToken = default) =>
        PostAsync<ExamBoardBootstrapResponse>(settings.BaseUrl, new
        {
            action = "plugin-bootstrap",
            pluginInstanceId = settings.PluginInstanceId,
            clientSecret = settings.ClientSecret,
            apiVersion = ApiVersion,
            clientVersion = ClientVersion,
        }, cancellationToken);

    public void Dispose() => _httpClient.Dispose();

    private async Task<ClientResult<T>> PostAsync<T>(
        string baseUrl,
        object body,
        CancellationToken cancellationToken)
    {
        if (!ExamBoardUrls.TryNormalizeBaseUrl(baseUrl, out var normalized, out var validationError))
        {
            return ClientResult<T>.Failure(validationError);
        }

        try
        {
            using var response = await _httpClient.PostAsJsonAsync(
                ExamBoardUrls.Api(normalized), body, _jsonOptions, cancellationToken);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed ||
                response.StatusCode == HttpStatusCode.BadRequest)
            {
                return ClientResult<T>.Failure("当前考试看板版本暂不支持 ClassIsland 插件联动");
            }
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                return ClientResult<T>.Failure("浏览器尚未完成班级配对");
            }
            if (!response.IsSuccessStatusCode)
            {
                return ClientResult<T>.Failure($"考试看板连接失败（HTTP {(int)response.StatusCode}）");
            }

            var value = await response.Content.ReadFromJsonAsync<T>(_jsonOptions, cancellationToken);
            return value is null
                ? ClientResult<T>.Failure("考试看板返回了空数据")
                : ClientResult<T>.Success(value);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return ClientResult<T>.Failure("连接考试看板超时");
        }
        catch (HttpRequestException)
        {
            return ClientResult<T>.Failure("无法连接考试看板，请检查网址和网络");
        }
        catch (JsonException)
        {
            return ClientResult<T>.Failure("考试看板返回的数据格式不兼容");
        }
        catch (Exception ex)
        {
            return ClientResult<T>.Failure($"连接失败：{ex.Message}");
        }
    }

    private sealed class SimpleResponse
    {
        public bool Ok { get; set; }
    }
}
