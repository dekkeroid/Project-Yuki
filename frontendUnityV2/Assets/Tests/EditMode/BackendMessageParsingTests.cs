using NUnit.Framework;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.TestTools;
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

    [Test]
    public void WavUtilHandlesInvalidInputGracefully()
    {
        var clipNull = Yuki.UnityFrontend.Backend.WavUtil.ToAudioClip((string)null);
        Assert.IsNull(clipNull);

        var clipEmpty = Yuki.UnityFrontend.Backend.WavUtil.ToAudioClip("");
        Assert.IsNull(clipEmpty);

        LogAssert.Expect(LogType.Error, "[WavUtil] Invalid WAV bytes or too short.");
        var clipShort = Yuki.UnityFrontend.Backend.WavUtil.ToAudioClip(new byte[10]);
        Assert.IsNull(clipShort);
    }
}
