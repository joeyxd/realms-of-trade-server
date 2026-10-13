#pragma once

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "ST01cProbeCommandlet.generated.h"

UCLASS()
class ST01CPROBE_API UST01cProbeCommandlet final : public UCommandlet
{
    GENERATED_BODY()

public:
    UST01cProbeCommandlet();
    virtual int32 Main(const FString& Params) override;
};
