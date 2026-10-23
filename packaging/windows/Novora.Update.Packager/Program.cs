using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Novora.Update;

// Signing key is read from a release-runner file path, never from a command-line secret value.
if (args.Length is not (6 or 8))
{
    Console.Error.WriteLine("Usage: packager <staged-app> <output> <repository> <minimum-version> <notes-file> <private-key-pem-file> [<setup-file> <setup-url>]");
    return 1;
}
var stage = Path.GetFullPath(args[0]);
var output = Path.GetFullPath(args[1]);
if (output.Equals(stage, StringComparison.OrdinalIgnoreCase) || output.StartsWith(stage.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("更新输出目录不能放在打包输入目录内。");
using var package = JsonDocument.Parse(File.ReadAllText(Path.Combine(stage, "package.json")));
var version = package.RootElement.GetProperty("version").GetString()!;
UpdatePackage.ParseVersion(version);
UpdatePackage.ParseVersion(args[3]);
var name = $"Novora-App-{version}-win-x64.zip";
var url = $"https://github.com/{args[2]}/releases/download/v{version}/{name}";
UpdatePackage.ValidateAssetUrl(url, args[2]);
Directory.CreateDirectory(output);
var payload = Path.Combine(output, name);
if (File.Exists(payload)) throw new IOException("输出包已存在，请使用新的输出目录。");
using (var zip = ZipFile.Open(payload, ZipArchiveMode.Create))
{
    foreach (var directory in new[] { "dist", "server-build", "node_modules" })
    {
        var source = Path.Combine(stage, directory);
        if (!Directory.Exists(source)) throw new DirectoryNotFoundException("缺少已构建应用目录：" + directory);
        var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var file in Directory.EnumerateFiles(source, "*", options))
            zip.CreateEntryFromFile(file, Path.GetRelativePath(stage, file).Replace('\\', '/'), CompressionLevel.Optimal);
    }
    foreach (var file in new[] { "package.json", "package-lock.json" }) zip.CreateEntryFromFile(Path.Combine(stage, file), file);
    // Only explicitly selected, additive transactional migrations belong here, never all historical migrations.
    var migrationDirectory = Path.Combine(stage, "update-migrations");
    if (Directory.Exists(migrationDirectory))
        foreach (var file in Directory.EnumerateFiles(migrationDirectory, "*.sql").Order(StringComparer.Ordinal))
            zip.CreateEntryFromFile(file, "migrations/" + Path.GetFileName(file));
}
var migrations = Directory.Exists(Path.Combine(stage, "update-migrations"))
    ? Directory.GetFiles(Path.Combine(stage, "update-migrations"), "*.sql").Select(x => "migrations/" + Path.GetFileName(x)).Order(StringComparer.Ordinal).ToArray() : [];
string hash;
using (var payloadStream = File.OpenRead(payload)) hash = Convert.ToHexString(SHA256.HashData(payloadStream));
SetupAsset? setup = null;
if (args.Length == 8)
{
    UpdatePackage.ValidateAssetUrl(args[7], args[2]);
    using var setupStream = File.OpenRead(args[6]);
    setup = new(args[7], setupStream.Length, Convert.ToHexString(SHA256.HashData(setupStream)));
}
var manifest = new ReleaseManifest(1, version, args[3], UpdatePackage.UpdaterVersion, "win-x64", 24, "backward-compatible",
    File.ReadAllText(args[4]), url, new FileInfo(payload).Length, hash, migrations, setup);
var bytes = JsonSerializer.SerializeToUtf8Bytes(manifest, UpdatePackage.Json);
using var rsa = RSA.Create();
rsa.ImportFromPem(File.ReadAllText(args[5]));
if (rsa.KeySize < 2048) throw new InvalidOperationException("发布签名至少需要 RSA 2048 位。");
var signature = rsa.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
_ = UpdatePackage.VerifyManifest(bytes, signature, new(args[2], rsa.ExportSubjectPublicKeyInfoPem()), args[3]);
File.WriteAllBytes(Path.Combine(output, "release-manifest.json"), bytes);
File.WriteAllBytes(Path.Combine(output, "release-manifest.sig"), signature);
using (var bundle = ZipFile.Open(Path.Combine(output, $"Novora-App-{version}-win-x64.nvu"), ZipArchiveMode.Create))
{
    bundle.CreateEntryFromFile(payload, "payload.zip", CompressionLevel.NoCompression);
    bundle.CreateEntryFromFile(Path.Combine(output, "release-manifest.json"), "release-manifest.json");
    bundle.CreateEntryFromFile(Path.Combine(output, "release-manifest.sig"), "release-manifest.sig");
}
Console.WriteLine($"Signed application update {version} written to {output}. No files were uploaded.");
return 0;
