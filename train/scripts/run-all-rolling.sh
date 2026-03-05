#!/bin/bash

################################################################################
# 批量滚动窗口训练和验证脚本
# 自动训练所有滚动窗口月份，并进行验证
################################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 显示帮助信息
show_help() {
    cat << EOF
批量滚动窗口训练和验证脚本

用法:
    $0 [选项]

选项:
    --train-only        只执行训练，不执行验证
    --validate-only     只执行验证，不执行训练
    --start YYYYMM      从指定月份开始（默认: 2025-01）
    --end YYYYMM        到指定月份结束（默认: 2026-02）
    --help, -h          显示此帮助信息

示例:
    # 训练和验证所有月份
    $0

    # 只训练所有月份
    $0 --train-only

    # 只验证所有月份
    $0 --validate-only

    # 训练和验证指定范围
    $0 --start 202501 --end 202512

EOF
}

# 默认参数
TRAIN=true
VALIDATE=true
START_YEAR=2025
START_MONTH=1
END_YEAR=2026
END_MONTH=2

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --train-only)
            VALIDATE=false
            shift
            ;;
        --validate-only)
            TRAIN=false
            shift
            ;;
        --start)
            START_DATE="$2"
            START_YEAR=${START_DATE:0:4}
            START_MONTH=$((10#${START_DATE:4:2}))
            shift 2
            ;;
        --end)
            END_DATE="$2"
            END_YEAR=${END_DATE:0:4}
            END_MONTH=$((10#${END_DATE:4:2}))
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

# 统计变量
TOTAL_TASKS=0
COMPLETED_TASKS=0
FAILED_TASKS=0
FAILED_CONFIGS=()

echo "================================================================================"
echo "🚀 批量滚动窗口训练和验证"
echo "================================================================================"
echo ""
log_info "配置范围: ${START_YEAR}-$(printf '%02d' $START_MONTH) 到 ${END_YEAR}-$(printf '%02d' $END_MONTH)"
log_info "执行训练: $TRAIN"
log_info "执行验证: $VALIDATE"
echo ""

# 生成月份列表
generate_months() {
    local year=$START_YEAR
    local month=$START_MONTH
    local months=()

    while [ $year -lt $END_YEAR ] || ([ $year -eq $END_YEAR ] && [ $month -le $END_MONTH ]); do
        months+=("${year}_$(printf '%02d' $month)")

        month=$((month + 1))
        if [ $month -gt 12 ]; then
            month=1
            year=$((year + 1))
        fi
    done

    echo "${months[@]}"
}

MONTHS=($(generate_months))
log_info "共 ${#MONTHS[@]} 个月份: ${MONTHS[@]}"
echo ""

# 训练阶段
if [ "$TRAIN" = true ]; then
    echo "================================================================================"
    echo "📊 阶段 1: 训练所有滚动窗口"
    echo "================================================================================"
    echo ""

    for month in "${MONTHS[@]}"; do
        TOTAL_TASKS=$((TOTAL_TASKS + 1))
        config="training/${month}_rolling"

        log_info "[$TOTAL_TASKS/${#MONTHS[@]}] 训练: $config"

        if make train CONFIG="$config"; then
            log_success "训练完成: $config"
            COMPLETED_TASKS=$((COMPLETED_TASKS + 1))
        else
            log_error "训练失败: $config"
            FAILED_TASKS=$((FAILED_TASKS + 1))
            FAILED_CONFIGS+=("$config")
        fi
        echo ""
    done

    echo "================================================================================"
    log_success "训练阶段完成: 成功 $COMPLETED_TASKS/$TOTAL_TASKS"
    if [ $FAILED_TASKS -gt 0 ]; then
        log_warning "失败 $FAILED_TASKS/$TOTAL_TASKS"
    fi
    echo "================================================================================"
    echo ""
fi

# 验证阶段
if [ "$VALIDATE" = true ]; then
    echo "================================================================================"
    echo "✅ 阶段 2: 验证所有滚动窗口"
    echo "================================================================================"
    echo ""

    VALIDATE_TOTAL=0
    VALIDATE_COMPLETED=0
    VALIDATE_FAILED=0

    for month in "${MONTHS[@]}"; do
        VALIDATE_TOTAL=$((VALIDATE_TOTAL + 1))
        config="validation/${month}_rolling_${month}_validation"

        log_info "[$VALIDATE_TOTAL/${#MONTHS[@]}] 验证: $config"

        if make validate CONFIG="$config"; then
            log_success "验证完成: $config"
            VALIDATE_COMPLETED=$((VALIDATE_COMPLETED + 1))
        else
            log_error "验证失败: $config"
            VALIDATE_FAILED=$((VALIDATE_FAILED + 1))
            FAILED_CONFIGS+=("$config")
        fi
        echo ""
    done

    echo "================================================================================"
    log_success "验证阶段完成: 成功 $VALIDATE_COMPLETED/$VALIDATE_TOTAL"
    if [ $VALIDATE_FAILED -gt 0 ]; then
        log_warning "失败 $VALIDATE_FAILED/$VALIDATE_TOTAL"
    fi
    echo "================================================================================"
    echo ""

    TOTAL_TASKS=$((TOTAL_TASKS + VALIDATE_TOTAL))
    COMPLETED_TASKS=$((COMPLETED_TASKS + VALIDATE_COMPLETED))
    FAILED_TASKS=$((FAILED_TASKS + VALIDATE_FAILED))
fi

# 最终汇总
echo "================================================================================"
echo "📋 执行汇总"
echo "================================================================================"
echo ""
log_info "总任务数: $TOTAL_TASKS"
log_success "成功: $COMPLETED_TASKS"

if [ $FAILED_TASKS -gt 0 ]; then
    log_error "失败: $FAILED_TASKS"
    echo ""
    echo "失败的配置:"
    for config in "${FAILED_CONFIGS[@]}"; do
        echo "  - $config"
    done
    echo ""
    exit 1
else
    log_success "全部任务完成!"
fi

echo ""
echo "================================================================================"
echo "🎉 批量处理完成!"
echo "================================================================================"
