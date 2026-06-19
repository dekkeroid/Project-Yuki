using NUnit.Framework;
using Newtonsoft.Json;
using Yuki.UnityFrontend.Chat;

public sealed class BackendMessageParsingTests
{
    [Test]
    public void ParsesConfirmRequest()
    {
        var json = "{\"type\":\"confirm_request\",\"conf_id\":\"abc\",\"name\":\"Run terminal command: echo hi\"}";
        var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);

        Assert.AreEqual("confirm_request", envelope.Type);
        Assert.AreEqual("abc", envelope.ConfirmationId);
        Assert.AreEqual("Run terminal command: echo hi", envelope.Name);
    }

    [Test]
    public void ParsesStreamingText()
    {
        var json = "{\"type\":\"text_stream\",\"text\":\"hello\",\"backend_used\":\"local\"}";
        var envelope = JsonConvert.DeserializeObject<YukiBackendEvent>(json);

        Assert.AreEqual("text_stream", envelope.Type);
        Assert.AreEqual("hello", envelope.Text);
        Assert.AreEqual("local", envelope.BackendUsed);
    }
}
