#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "ST01cRuntimeProbe.generated.h"

class UNiagaraSystem;
class UNiagaraComponent;

// Editor-only, bounded observation of the isolated pilot. Never saves an asset.
UCLASS()
class ST01CPROBE_API UST01cRuntimeProbe final : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ConfigurePilot(UNiagaraSystem* System);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ReadParticles(UNiagaraComponent* Component);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString PrepareCapture(UNiagaraComponent* Component);
};
