using UnrealBuildTool;

public class ST01cProbe : ModuleRules
{
    public ST01cProbe(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "Niagara",
            "NiagaraCore",
            "UnrealEd",
            "Json",
            "JsonUtilities"
        });
    }
}
