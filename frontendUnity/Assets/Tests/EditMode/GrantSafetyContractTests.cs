using NUnit.Framework;
using Newtonsoft.Json;
using Yuki.UnityFrontend.Backend;

public sealed class GrantSafetyContractTests
{
    [Test]
    public void OpenPlayConfirmPayloadUsesPendingConfirmationId()
    {
        var payload = YukiRestClient.BuildOpenPlayPayload("notepad", false, "pending-123");
        var json = JsonConvert.SerializeObject(payload);

        StringAssert.Contains("pending_confirmation_id", json);
        Assert.False(json.Contains("confirmation_grant_id"));
    }
}
